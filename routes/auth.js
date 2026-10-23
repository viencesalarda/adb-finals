const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { wrap, requireGuest } = require('../middleware/auth');

const router = express.Router();

const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const COURSES = ['BSCRIM', 'BSIT', 'BSTM', 'BSHM', 'BSME', 'BSED'];

// ADMIN MIDDLEWARE
const requireAdmin = wrap(async (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const [users] = await db.query(
        'SELECT role, is_admin FROM users WHERE id = ?',
        [req.session.user.id]
    );

    if (
        users.length === 0 ||
        (
            users[0].role !== 'admin' &&
            Number(users[0].is_admin) !== 1
        )
    ) {
        return res.status(403).send('Access denied. Admin only.');
    }

    next();
});

// REGISTER PAGE
router.get('/register', requireGuest, (req, res) => {
    res.render('auth/register', {
        title: 'Register',
        bodyClass: 'register-bg'
    });
});

// REGISTER ACCOUNT
router.post('/register', requireGuest, wrap(async (req, res) => {
    const { name, email, password, year_level, course } = req.body;

    if (
        !name || !email || !password ||
        password.length < 6 ||
        !YEARS.includes(year_level) ||
        !COURSES.includes(course)
    ) {
        req.session.flash = {
            type: 'error',
            text: 'All fields are required. Password must be at least 6 characters.'
        };

        return res.redirect('/register');
    }

    const mail = email.toLowerCase().trim();

    if (!mail.endsWith('@phinmaed.com')) {
        req.session.flash = {
            type: 'error',
            text: 'Please use your @phinmaed.com email.'
        };

        return res.redirect('/register');
    }

    const [students] = await db.query(
        `SELECT id FROM enrolled_students
         WHERE LOWER(TRIM(email)) = ? AND is_active = 1`,
        [mail]
    );

    if (students.length === 0) {
        req.session.flash = {
            type: 'error',
            text: 'Registration denied. You are not on the verified student list.'
        };

        return res.redirect('/register');
    }

    const [existing] = await db.query(
        'SELECT id FROM users WHERE email = ?',
        [mail]
    );

    if (existing.length > 0) {
        req.session.flash = {
            type: 'error',
            text: 'That email is already registered.'
        };

        return res.redirect('/register');
    }

    const hash = await bcrypt.hash(password, 10);

    await db.query(
        `INSERT INTO users
         (name, email, year_level, course, password_hash)
         VALUES (?, ?, ?, ?, ?)`,
        [name.trim(), mail, year_level, course, hash]
    );

    req.session.flash = {
        type: 'success',
        text: 'Student verified! Account created. Please log in.'
    };

    return res.redirect('/login');
}));

// LOGIN PAGE
router.get('/login', requireGuest, (req, res) => {
    res.render('auth/login', {
        title: 'Log in',
        bodyClass: 'register-bg'
    });
});

// LOGIN ACCOUNT
router.post('/login', requireGuest, wrap(async (req, res) => {
    const { email, password } = req.body;

    const [rows] = await db.query(
        'SELECT * FROM users WHERE email = ?',
        [(email || '').toLowerCase().trim()]
    );

    const user = rows[0];

    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
        req.session.flash = {
            type: 'error',
            text: 'Invalid email or password.'
        };

        return res.redirect('/login');
    }

    req.session.regenerate((err) => {
        if (err) {
            return res.status(500).send(
                'Could not create a login session. Please try again.'
            );
        }

        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            year_level: user.year_level,
            course: user.course,
            role: user.role,
            is_admin: user.is_admin
        };

        if (
            user.role === 'admin' ||
            Number(user.is_admin) === 1
        ) {
            return res.redirect('/admin/dashboard');
        }

        return res.redirect('/');
    });
}));

// ADMIN DASHBOARD
router.get('/admin/dashboard', requireAdmin, wrap(async (req, res) => {
    const [userCount] = await db.query(
        'SELECT COUNT(*) AS total FROM users'
    );

    const [itemCount] = await db.query(
        `SELECT
            COUNT(*) AS total,
            COALESCE(SUM(type = 'lost'), 0)  AS lost,
            COALESCE(SUM(type = 'found'), 0) AS found
         FROM items`
    );

    return res.render('dashboard', {
        title: 'Admin Dashboard',
        userTotal: userCount[0].total,
        itemTotal: itemCount[0].total,
        lostTotal: Number(itemCount[0].lost),
        foundTotal: Number(itemCount[0].found),
        user: req.session.user
    });
}));

// VIEW AND SEARCH ACCOUNTS
router.get('/admin/accounts', requireAdmin, wrap(async (req, res) => {
    const search = (req.query.search || '').trim();

    const [accounts] = await db.query(
        `SELECT id, name, email, course, year_level, role, is_admin
         FROM users
         WHERE name LIKE ? OR email LIKE ?
         ORDER BY id DESC`,
        [`%${search}%`, `%${search}%`]
    );

    return res.render('admin/accounts', {
        title: 'Manage Accounts',
        accounts,
        search
    });
}));

// ADD ACCOUNT PAGE
router.get('/admin/accounts/add', requireAdmin, (req, res) => {
    return res.render('admin/add-account', {
        title: 'Add Account',
        courses: COURSES,
        years: YEARS
    });
});

// CREATE ACCOUNT
router.post('/admin/accounts/add', requireAdmin, wrap(async (req, res) => {
    const { name, email, password, course, year_level, role } = req.body;

    const mail = (email || '').toLowerCase().trim();

    if (
        !name || !mail || !password ||
        password.length < 6 ||
        !COURSES.includes(course) ||
        !YEARS.includes(year_level) ||
        !['user', 'admin'].includes(role)
    ) {
        req.session.flash = {
            type: 'error',
            text: 'Please complete all fields correctly. Password must be at least 6 characters.'
        };

        return res.redirect('/admin/accounts/add');
    }

    const [existing] = await db.query(
        'SELECT id FROM users WHERE email = ?',
        [mail]
    );

    if (existing.length > 0) {
        req.session.flash = {
            type: 'error',
            text: 'That email is already registered.'
        };

        return res.redirect('/admin/accounts/add');
    }

    const hash = await bcrypt.hash(password, 10);
    const isAdmin = role === 'admin' ? 1 : 0;

    await db.query(
        `INSERT INTO users
         (name, email, year_level, course, password_hash, role, is_admin)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name.trim(), mail, year_level, course, hash, role, isAdmin]
    );

    req.session.flash = {
        type: 'success',
        text: 'Account created successfully.'
    };

    return res.redirect('/admin/accounts');
}));

// EDIT ACCOUNT PAGE
router.get('/admin/accounts/edit/:id', requireAdmin, wrap(async (req, res) => {
    const [rows] = await db.query(
        `SELECT id, name, email, course, year_level, role, is_admin
         FROM users
         WHERE id = ?`,
        [req.params.id]
    );

    if (rows.length === 0) {
        return res.status(404).send('Account not found.');
    }

    return res.render('admin/edit-account', {
        title: 'Edit Account',
        account: rows[0],
        courses: COURSES,
        years: YEARS
    });
}));

// UPDATE ACCOUNT
router.post('/admin/accounts/edit/:id', requireAdmin, wrap(async (req, res) => {
    const { name, email, course, year_level, role } = req.body;
    const mail = (email || '').toLowerCase().trim();

    if (
        !name || !mail ||
        !COURSES.includes(course) ||
        !YEARS.includes(year_level) ||
        !['user', 'admin'].includes(role)
    ) {
        req.session.flash = {
            type: 'error',
            text: 'Please complete all fields correctly.'
        };

        return res.redirect(`/admin/accounts/edit/${req.params.id}`);
    }

    const [account] = await db.query(
        'SELECT id FROM users WHERE id = ?',
        [req.params.id]
    );

    if (account.length === 0) {
        return res.status(404).send('Account not found.');
    }

    const [duplicate] = await db.query(
        'SELECT id FROM users WHERE email = ? AND id <> ?',
        [mail, req.params.id]
    );

    if (duplicate.length > 0) {
        req.session.flash = {
            type: 'error',
            text: 'That email is already used by another account.'
        };

        return res.redirect(`/admin/accounts/edit/${req.params.id}`);
    }

    const isAdmin = role === 'admin' ? 1 : 0;

    await db.query(
        `UPDATE users
         SET name = ?, email = ?, course = ?, year_level = ?,
             role = ?, is_admin = ?
         WHERE id = ?`,
        [
            name.trim(),
            mail,
            course,
            year_level,
            role,
            isAdmin,
            req.params.id
        ]
    );

    if (Number(req.params.id) === Number(req.session.user.id)) {
        req.session.user.name = name.trim();
        req.session.user.email = mail;
        req.session.user.course = course;
        req.session.user.year_level = year_level;
        req.session.user.role = role;
        req.session.user.is_admin = isAdmin;
    }

    req.session.flash = {
        type: 'success',
        text: 'Account updated successfully.'
    };

    return res.redirect('/admin/accounts');
}));

// DELETE ACCOUNT
router.post('/admin/accounts/delete/:id', requireAdmin, wrap(async (req, res) => {
    const accountId = Number(req.params.id);

    if (!Number.isInteger(accountId) || accountId <= 0) {
        return res.status(400).send('Invalid account ID.');
    }

    if (accountId === Number(req.session.user.id)) {
        req.session.flash = {
            type: 'error',
            text: 'You cannot delete your own account while logged in.'
        };

        return res.redirect('/admin/accounts');
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [account] = await connection.query(
            'SELECT id FROM users WHERE id = ? FOR UPDATE',
            [accountId]
        );

        if (account.length === 0) {
            await connection.rollback();

            req.session.flash = {
                type: 'error',
                text: 'Account not found.'
            };

            return res.redirect('/admin/accounts');
        }

        // DELETE MESSAGES SENT OR RECEIVED BY THE ACCOUNT
        await connection.query(
            'DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?',
            [accountId, accountId]
        );

        // DELETE MESSAGES CONNECTED TO THE ACCOUNT'S ITEMS
        await connection.query(
            `DELETE FROM messages
             WHERE item_id IN (
                 SELECT id FROM (
                     SELECT id FROM items WHERE user_id = ?
                 ) AS owned_items
             )`,
            [accountId]
        );

        // DELETE ITEMS OWNED BY THE ACCOUNT
        await connection.query(
            'DELETE FROM items WHERE user_id = ?',
            [accountId]
        );

        // DELETE ACCOUNT
        await connection.query(
            'DELETE FROM users WHERE id = ?',
            [accountId]
        );

        await connection.commit();

        req.session.flash = {
            type: 'success',
            text: 'Account deleted successfully.'
        };

        return res.redirect('/admin/accounts');

    } catch (error) {
        await connection.rollback();

        console.error('Delete account error:', error);

        req.session.flash = {
            type: 'error',
            text: 'Could not delete account. Check the server terminal for the database error.'
        };

        return res.redirect('/admin/accounts');

    } finally {
        connection.release();
    }
}));

// LOGOUT
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send(
                'Could not log out. Please try again.'
            );
        }

        return res.redirect('/');
    });
});

module.exports = router;