const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(bodyParser.json());

// --- БАЗА ДАННЫХ ---
let db = { 
    users: {}, 
    orders: [], 
    logs: [],
    reports: [] 
};

// Загрузка базы при старте
if (fs.existsSync(DB_FILE)) {
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const loaded = JSON.parse(raw);
        if(loaded.users) db.users = loaded.users;
        if(loaded.orders) db.orders = loaded.orders;
        if(loaded.logs) db.logs = loaded.logs;
        if(loaded.reports) db.reports = loaded.reports;
    } catch (e) { console.log('Ошибка чтения базы', e); }
}

const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// Функция записи в лог
const logEvent = (type, email, desc) => {
    const record = { time: new Date().toLocaleString(), type, email, desc };
    db.logs.unshift(record); // Добавляем в начало списка
    if (db.logs.length > 200) db.logs.pop(); // Храним последние 200 записей
    save();
};

// --- МАРШРУТЫ КЛИЕНТА ---

// 1. ВХОД
app.post('/get-balance', (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ success: false });

    if (!db.users[email]) {
        db.users[email] = { 
            balance: 0, 
            name: email.split('@')[0],
            isElite: false,
            joined: new Date().toLocaleString()
        };
        // Админский бонус
        if(email === 'sergeytirayan23@gmail.com') db.users[email].balance = 100000;
        logEvent('REGISTER', email, 'Новый пользователь');
    }

    db.users[email].lastSeen = Date.now();
    save();
    res.json({ 
        success: true, 
        balance: db.users[email].balance, 
        name: db.users[email].name,
        isElite: db.users[email].isElite
    });
});

// 2. ПОКУПКА ТОВАРА
app.post('/buy-item', (req, res) => {
    const { email, itemName, price } = req.body;
    const user = db.users[email];

    if (user && user.balance >= price) {
        user.balance -= price;
        user.lastSeen = Date.now();
        
        const order = { id: Date.now(), email, item: itemName, price, date: new Date().toLocaleString() };
        db.orders.unshift(order);
        
        logEvent('BUY', email, `Купил ${itemName} (-$${price})`);
        save();
        res.json({ success: true, newBalance: user.balance });
    } else {
        res.json({ success: false, message: 'Недостаточно средств' });
    }
});

// 3. РУЛЕТКА (Логируем на сервере)
app.post('/spin-roulette', (req, res) => {
    const { email } = req.body;
    const bonus = 5; 
    
    logEvent('ROULETTE', email, `Прокрутил рулетку. Приз: ${bonus}%`);
    db.users[email].lastSeen = Date.now();
    save();
    
    res.json({ success: true, bonus: bonus });
});

// 4. ПОКУПКА ELITE (Логируем)
app.post('/buy-elite', (req, res) => {
    const { email } = req.body;
    const user = db.users[email];
    const price = 100;

    if(user && user.balance >= price) {
        user.balance -= price;
        user.isElite = true;
        logEvent('ELITE', email, `Купил статус ELITE (-$100)`);
        save();
        res.json({ success: true, newBalance: user.balance });
    } else {
        res.json({ success: false, message: 'Недостаточно средств' });
    }
});

// 5. ТЕХПОДДЕРЖКА (Вопрос)
app.post('/send-report', (req, res) => {
    const { email, message } = req.body;
    const report = {
        id: Date.now(),
        email,
        question: message,
        answer: null,
        date: new Date().toLocaleString()
    };
    db.reports.unshift(report);
    logEvent('SUPPORT', email, `Спросил: "${message}"`);
    save();
    res.json({ success: true });
});

// 6. ТЕХПОДДЕРЖКА (Проверка ответов)
app.post('/my-reports', (req, res) => {
    const { email } = req.body;
    const myReports = db.reports.filter(r => r.email === email);
    res.json({ reports: myReports });
});

// --- АДМИНСКИЕ МАРШРУТЫ ---

app.get('/admin/data', (req, res) => {
    const userList = Object.keys(db.users).map(email => {
        const u = db.users[email];
        const isOnline = (Date.now() - (u.lastSeen || 0)) < 2 * 60 * 1000; 
        return { 
            email, 
            balance: u.balance, 
            isOnline, 
            isElite: u.isElite,
            lastSeen: u.lastSeen ? new Date(u.lastSeen).toLocaleString() : 'Давно' 
        };
    });

    res.json({ 
        users: userList, 
        orders: db.orders,
        logs: db.logs,
        reports: db.reports
    });
});

// Управление деньгами (ЛЮБАЯ СУММА)
app.post('/admin/money', (req, res) => {
    const { email, amount } = req.body;
    const val = parseInt(amount);
    
    if (db.users[email] && !isNaN(val)) {
        db.users[email].balance += val;
        save();
        logEvent('ADMIN', 'BOSS', `${val > 0 ? 'Начислил' : 'Снял'} $${Math.abs(val)} у ${email}`);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Ответ на репорт
app.post('/admin/reply-report', (req, res) => {
    const { id, answer } = req.body;
    const report = db.reports.find(r => r.id === id);
    if(report) {
        report.answer = answer;
        logEvent('SUPPORT', 'Admin', `Ответил ${report.email}: "${answer}"`);
        save();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Очистка логов (С ПАРОЛЕМ)
app.post('/admin/clear-logs', (req, res) => {
    const { password } = req.body;
    if(password === 'Sergeytirayan2011') {
        db.logs = [];
        save();
        console.log('🗑️ ЛОГИ ОЧИЩЕНЫ АДМИНОМ');
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.listen(PORT, () => console.log(`✅ SERVER v5 ЗАПУЩЕН НА ПОРТУ ${PORT}`));