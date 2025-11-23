const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const app = express();
const PORT = 3333;

app.use(express.json());
app.use(cors());

// MySQL Pool
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "0070",
  database: "gps_sharing",
  waitForConnections: true,
  connectionLimit: 10,
});

/******************************************************
 * DB 초기화
 ******************************************************/
async function initializeDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS locations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        latitude DECIMAL(12,9) NOT NULL,
        longitude DECIMAL(13,9) NOT NULL,
        heading DECIMAL(10,5) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_time (timestamp)
      )
    `);

    console.log("DB initialized ✓");
  } catch (err) {
    console.error("DB initialization error:", err);
  } finally {
    connection.release();
  }
}

/******************************************************
 * 1) 위치 저장
 ******************************************************/
app.post("/api/locations", async (req, res) => {
  const { userId, latitude, longitude, heading } = req.body;

  const lat = Number(latitude);
  const lng = Number(longitude);
  const h = Number(heading);

  if (!userId || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(h)) {
    return res.status(400).json({ error: "Invalid parameters" });
  }

  const conn = await pool.getConnection();

  try {
    // 사용자 없으면 생성
    await conn.execute("INSERT IGNORE INTO users (id) VALUES (?)", [userId]);

    // 오래된 데이터 제거 (1시간)
    await conn.execute(
      "DELETE FROM locations WHERE user_id = ? AND timestamp < DATE_SUB(NOW(), INTERVAL 1 HOUR)",
      [userId]
    );

    // 위치 저장
    const [result] = await conn.execute(
      `
      INSERT INTO locations (user_id, latitude, longitude, heading)
      VALUES (?, ?, ?, ?)
      `,
      [userId, lat, lng, h]
    );

    res.json({
      success: true,
      message: "Location updated ✓",
      data: { id: result.insertId, userId, lat, lng, heading: h },
    });

  } catch (err) {
    console.error("Error updating location:", err);
    res.status(500).json({ error: "Failed to update location" });
  } finally {
    conn.release();
  }
});

/******************************************************
 * 2) 전체 유저 최신 위치 조회
 ******************************************************/
app.get("/api/locations/:userId", async (req, res) => {
  const { userId } = req.params;
  const conn = await pool.getConnection();

  try {
    // 나
    const [me] = await conn.execute(
      `SELECT user_id AS id, latitude, longitude, heading, timestamp
       FROM locations
       WHERE user_id = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [userId]
    );

    // 타인
    const [others] = await conn.execute(
      `
      SELECT l.user_id AS id, l.latitude, l.longitude, l.heading, l.timestamp
      FROM locations l
      JOIN (
         SELECT user_id, MAX(timestamp) AS max_ts
         FROM locations
         WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 MINUTE)
           AND user_id <> ?
         GROUP BY user_id
      ) t
        ON l.user_id = t.user_id AND l.timestamp = t.max_ts
      ORDER BY l.timestamp DESC
      LIMIT 10
      `,
      [userId]
    );

    const result = [...me, ...others];

    res.json({
      success: true,
      count: result.length,
      data: result.map((u) => ({
        id: u.id,
        lat: Number(u.latitude),
        lng: Number(u.longitude),
        heading: Number(u.heading),
        timestamp: u.timestamp,
      })),
    });

  } catch (err) {
    console.error("Error fetching:", err);
    res.status(500).json({ error: "Failed to fetch" });
  } finally {
    conn.release();
  }
});

/******************************************************
 * 3) 전체 위치 삭제
 ******************************************************/
app.delete("/api/locations", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.execute("DELETE FROM locations");
    res.json({ success: true, message: "All location data deleted" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  } finally {
    conn.release();
  }
});

/******************************************************
 * 서버 시작
 ******************************************************/
async function startServer() {
  await initializeDatabase();
  app.listen(PORT, () => console.log(`Server running http://localhost:${PORT}`));
}

startServer();
