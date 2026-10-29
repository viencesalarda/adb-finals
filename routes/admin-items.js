
const express = require('express');
const router = express.Router();
const db = require('../db');

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
}

function requireAdmin(req, res, next) {
    const user = req.session.user;

    if (
        user &&
        (user.role === 'admin' || Number(user.is_admin) === 1)
    ) {
        return next();
    }

    return res.status(403).send('Access denied. Admin only.');
}

router.use(requireLogin, requireAdmin);

router.get('/', async (req, res) => {
    try {
        const [items] = await db.query(
            'SELECT * FROM items ORDER BY created_at DESC'
        );

        res.render('admin/items', {
            user: req.session.user,
            items: items
        });
    } catch (err) {
        console.error('Failed to load reports:', err);
        res.status(500).send('Failed to load reports.');
    }
});

router.get('/new', (req, res) => {
    res.render('admin/item-new', {
        user: req.session.user
    });
});

router.post('/new', async (req, res) => {
    try {
        const {
            type,
            title,
            description,
            category,
            location,
            date_lost_found,
            status
        } = req.body;

        if (
            !['lost', 'found'].includes(type) ||
            !title ||
            !title.trim() ||
            !category ||
            !location ||
            !location.trim() ||
            !date_lost_found
        ) {
            return res.status(400).send(
                'Please complete all required fields.'
            );
        }

        const sql = `
            INSERT INTO items
            (user_id, type, title, description, category,
             location, date_lost_found, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            req.session.user.id,
            type,
            title.trim(),
            description || '',
            category,
            location.trim(),
            date_lost_found,
            status || 'open'
        ];

        await db.query(sql, values);

        res.redirect('/admin/items');
    } catch (err) {
        console.error('Failed to create report:', err);
        res.status(500).send('Failed to create report.');
    }
});

router.get('/:id/edit', async (req, res) => {
    try {
        const [results] = await db.query(
            'SELECT * FROM items WHERE id = ?',
            [req.params.id]
        );

        if (results.length === 0) {
            return res.status(404).send('Report not found.');
        }

        res.render('admin/item-edit', {
            user: req.session.user,
            item: results[0]
        });
    } catch (err) {
        console.error('Failed to load report:', err);
        res.status(500).send('Failed to load report.');
    }
});

router.post('/:id/edit', async (req, res) => {
    try {
        const {
            type,
            title,
            description,
            category,
            location,
            date_lost_found,
            status
        } = req.body;

        if (
            !['lost', 'found'].includes(type) ||
            !title ||
            !title.trim() ||
            !category ||
            !location ||
            !location.trim() ||
            !date_lost_found ||
            !['open', 'claimed', 'resolved'].includes(status)
        ) {
            return res.status(400).send(
                'Invalid report information.'
            );
        }

        const sql = `
            UPDATE items
            SET type = ?, title = ?, description = ?, category = ?,
                location = ?, date_lost_found = ?, status = ?
            WHERE id = ?
        `;

        const values = [
            type,
            title.trim(),
            description || '',
            category,
            location.trim(),
            date_lost_found,
            status,
            req.params.id
        ];

        const [result] = await db.query(sql, values);

        if (result.affectedRows === 0) {
            return res.status(404).send('Report not found.');
        }

        res.redirect('/admin/items');
    } catch (err) {
        console.error('Failed to update report:', err);
        res.status(500).send('Failed to update report.');
    }
});

router.post('/:id/delete', async (req, res) => {
    try {
        const [result] = await db.query(
            'DELETE FROM items WHERE id = ?',
            [req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).send('Report not found.');
        }

        res.redirect('/admin/items');
    } catch (err) {
        console.error('Failed to delete report:', err);
        res.status(500).send('Failed to delete report.');
    }
});

module.exports = router;
