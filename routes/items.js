const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireLogin, wrap } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = [
    'Wallet',
    'ID / Cards',
    'Phone / Charger',
    'Keys',
    'Bag',
    'Clothing',
    'Umbrella',
    'Books / Notes',
    'Other'
];

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) => {
            cb(
                null,
                Date.now() + '-' +
                Math.round(Math.random() * 1e6) +
                path.extname(file.originalname).toLowerCase()
            );
        }
    }),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)
            ? cb(null, true)
            : cb(new Error('Only image files are allowed.'));
    }
});

function isAdminUser(user) {
    return !!user && (user.role === 'admin' || Number(user.is_admin) === 1);
}

// HOME PAGE / SEARCH
router.get('/', wrap(async (req, res) => {
    const {
        q = '',
        type = '',
        category = '',
        location = '',
        status = ''
    } = req.query;

    const where = [];
    const args = [];

    if (type === 'lost' || type === 'found') {
        where.push('i.type = ?');
        args.push(type);
    }

    if (category) {
        where.push('i.category = ?');
        args.push(category);
    }

    if (location.trim()) {
        where.push('i.location LIKE ?');
        args.push(`%${location.trim()}%`);
    }

    if (q.trim()) {
        where.push('(i.title LIKE ? OR i.description LIKE ?)');
        args.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }

    if (status === 'open' || status === 'returned') {
        where.push('i.status = ?');
        args.push(status);
    }

    const [items] = await db.query(
        `SELECT i.*, u.name AS poster
        FROM items i
        LEFT JOIN users u ON u.id = i.user_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT 100`,
        args
    );

    res.render('items/index', {
        title: 'Campus Lost & Found',
        bodyClass: 'home-bg',
        items,
        categories: CATEGORIES,
        filters: { q, type, category, location, status }
    });
}));

router.get('/items', (req, res) => {
    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex !== -1
        ? req.originalUrl.slice(queryIndex)
        : '';

    res.redirect('/' + query);
});

router.get('/my-items', requireLogin, wrap(async (req, res) => {
    const [items] = await db.query(
        `SELECT *
        FROM items
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC`,
        [req.session.user.id]
    );

    res.render('items/mine', {
        title: 'My reports',
        items
    });
}));

router.get('/items/new', requireLogin, (req, res) => {
    res.render('items/new', {
        title: 'Post an item',
        categories: CATEGORIES,
        type: req.query.type === 'found' ? 'found' : 'lost',
        bodyClass: 'post-bg'
    });
});

router.post('/items', requireLogin, (req, res, next) => {
    upload.single('photo')(req, res, async (err) => {
        try {
            if (err) {
                req.session.flash = {
                    type: 'error',
                    text: err.message
                };

                return res.redirect('/items/new');
            }

            const {
                type,
                title,
                description,
                category,
                location,
                event_date
            } = req.body;

            if (
                !['lost', 'found'].includes(type) ||
                !title ||
                !category ||
                !location
            ) {
                if (req.file) {
                    fs.unlink(req.file.path, () => {});
                }

                req.session.flash = {
                    type: 'error',
                    text: 'Type, title, category and location are required.'
                };

                return res.redirect('/items/new');
            }

            const [result] = await db.query(
                `INSERT INTO items
                (user_id, type, title, description, category, location,
                date_lost_found, image)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.session.user.id,
                    type,
                    title.trim(),
                    (description || '').trim(),
                    category,
                    location.trim(),
                    event_date || null,
                    req.file ? req.file.filename : null
                ]
            );

            req.session.flash = {
                type: 'success',
                text: 'Report posted.'
            };

            if (isAdminUser(req.session.user)) {
                return res.redirect('/admin/items');
            }

            res.redirect('/items/' + result.insertId);
        } catch (e) {
            if (req.file) {
                fs.unlink(req.file.path, () => {});
            }

            next(e);
        }
    });
});

router.get('/items/:id', wrap(async (req, res, next) => {
    const [rows] = await db.query(
        `SELECT i.*, u.name AS poster
        FROM items i
        LEFT JOIN users u ON u.id = i.user_id
        WHERE i.id = ?`,
        [req.params.id]
    );

    const item = rows[0];

    if (!item) {
        return next();
    }

    const isOwner = !!req.session.user &&
        Number(req.session.user.id) === Number(item.user_id);

    let messages = [];

    if (isOwner) {
        [messages] = await db.query(
            `SELECT m.*, u.name AS sender, u.email AS sender_email
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.item_id = ?
            ORDER BY m.created_at DESC, m.id DESC`,
            [item.id]
        );
    }

    res.render('items/show', {
        title: item.title,
        item,
        isOwner,
        messages
    });
}));

router.post(
    '/items/:id/update',
    requireLogin,
    (req, res, next) => {
        upload.single('photo')(req, res, async (err) => {
            try {
                if (err) {
                    req.session.flash = {
                        type: 'error',
                        text: err.message
                    };

                    return res.redirect('/items/' + req.params.id);
                }

                const {
                    type,
                    title,
                    description,
                    category,
                    location,
                    event_date,
                    status
                } = req.body;

                if (
                    !['lost', 'found'].includes(type) ||
                    !title ||
                    !category ||
                    !location ||
                    !['open', 'returned'].includes(status)
                ) {
                    if (req.file) {
                        fs.unlink(req.file.path, () => {});
                    }

                    req.session.flash = {
                        type: 'error',
                        text: 'Please complete all required fields.'
                    };

                    return res.redirect('/items/' + req.params.id);
                }

                const [existingRows] = await db.query(
                    'SELECT * FROM items WHERE id = ? AND user_id = ?',
                    [req.params.id, req.session.user.id]
                );

                const existingItem = existingRows[0];

                if (!existingItem) {
                    if (req.file) {
                        fs.unlink(req.file.path, () => {});
                    }

                    req.session.flash = {
                        type: 'error',
                        text: 'Item not found or you are not allowed to update it.'
                    };

                    return res.redirect('/my-items');
                }

                const image = req.file
                    ? req.file.filename
                    : existingItem.image;

                await db.query(
                    `UPDATE items
                    SET type = ?, title = ?, description = ?,
                        category = ?, location = ?,
                        date_lost_found = ?, status = ?, image = ?
                    WHERE id = ? AND user_id = ?`,
                    [
                        type,
                        title.trim(),
                        (description || '').trim(),
                        category,
                        location.trim(),
                        event_date || null,
                        status,
                        image,
                        req.params.id,
                        req.session.user.id
                    ]
                );

                if (req.file && existingItem.image) {
                    fs.unlink(
                        path.join(UPLOAD_DIR, existingItem.image),
                        () => {}
                    );
                }

                req.session.flash = {
                    type: 'success',
                    text: 'Item updated successfully.'
                };

                res.redirect('/items/' + req.params.id);
            } catch (e) {
                if (req.file) {
                    fs.unlink(req.file.path, () => {});
                }

                next(e);
            }
        });
    }
);

router.post('/items/:id/contact', requireLogin, wrap(async (req, res, next) => {
    const [rows] = await db.query(
        'SELECT * FROM items WHERE id = ?',
        [req.params.id]
    );

    const item = rows[0];

    if (!item) {
        return next();
    }

    const body = (req.body.body || '').trim();

    if (
        Number(item.user_id) === Number(req.session.user.id) ||
        !body
    ) {
        req.session.flash = {
            type: 'error',
            text: 'Write a message (you cannot message yourself).'
        };

        return res.redirect('/items/' + item.id);
    }

    await db.query(
        `INSERT INTO messages
        (item_id, sender_id, receiver_id, message)
        VALUES (?, ?, ?, ?)`,
        [
            item.id,
            req.session.user.id,
            item.user_id,
            body
        ]
    );

    req.session.flash = {
        type: 'success',
        text: 'Message sent to the poster.'
    };

    res.redirect('/items/' + item.id);
}));

router.post('/items/:id/return', requireLogin, wrap(async (req, res) => {
    const [result] = await db.query(
        `UPDATE items
        SET status = 'returned'
        WHERE id = ? AND user_id = ?`,
        [req.params.id, req.session.user.id]
    );

    req.session.flash = result.affectedRows
        ? { type: 'success', text: 'Marked as returned.' }
        : { type: 'error', text: 'Not allowed.' };

    res.redirect('/items/' + req.params.id);
}));

router.post('/items/:id/delete', requireLogin, wrap(async (req, res) => {
    const [rows] = await db.query(
        `SELECT *
        FROM items
        WHERE id = ? AND user_id = ?`,
        [req.params.id, req.session.user.id]
    );

    const item = rows[0];

    if (item) {
        await db.query(
            'DELETE FROM items WHERE id = ?',
            [item.id]
        );

        if (item.image) {
            fs.unlink(
                path.join(UPLOAD_DIR, item.image),
                () => {}
            );
        }
    }

    res.redirect('/my-items');
}));

module.exports = router;