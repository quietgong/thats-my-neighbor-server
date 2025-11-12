// server.js
const express = require('express');
const app = express();
const PORT = 3333;

// /api 엔드포인트 정의
app.get('/api', (req, res) => {
  res.send('hello from youngdo');
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
