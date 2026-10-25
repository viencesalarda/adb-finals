const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


app.locals.slides = require('./data/slides');


app.locals.slides.forEach(s => {
    const file = path.join(__dirname, 'public', 'img', 'slides', s.image);
    console.log(fs.existsSync(file) ? 'OK photo:' : 'MISSING photo:', s.image);
});

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/items'));

app.use('/admin/items', require('./routes/admin-items'));

app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Not found',
        message: 'Page not found.'
    });
});

app.use((err, req, res, next) => {
    console.error('ERROR:', err);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).send(
        '<pre>' + (err.stack || err.message) + '</pre>'
    );
});

app.listen(PORT, () => {
    console.log(`Campus Lost & Found running at http://localhost:${PORT}`);
});