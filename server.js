const express = require("express")
const mysql = require("mysql2/promise")
const cors = require("cors");
const app = express()
const PORT = 3333

// 미들웨어
app.use(express.json())
app.use(cors())

// MySQL 연결 풀
const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "0070",
    database: "gps_sharing",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
})

// 데이터베이스 초기화
async function initializeDatabase() {
    const connection = await pool.getConnection()
    try {
        // users 테이블 생성 (username 없음)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `)

        // locations 테이블 생성 (accuracy 없음)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS locations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_id (user_id),
                INDEX idx_timestamp (timestamp)
            )
        `)

        console.log("Database tables initialized successfully")
    } catch (error) {
        console.error("Database initialization error:", error)
    } finally {
        connection.release()
    }
}

// 사용자 위치 업로드 (또는 업데이트)
app.post("/api/locations", async (req, res) => {
    const { userId, latitude, longitude } = req.body

    // 숫자로 변환
    const lat = Number(latitude)
    const lng = Number(longitude)

    // 입력값 검증 (0도도 허용, 문자열도 숫자로 변환해서 체크)
    if (!userId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: "Invalid input parameters" })
    }

    const connection = await pool.getConnection()
    try {
        // 사용자가 존재하지 않으면 생성
        await connection.execute("INSERT IGNORE INTO users (id) VALUES (?)", [userId])

        // 위치 정보 저장 (최근 한 시간 이상 된 이전 위치는 삭제)
        await connection.execute(
            "DELETE FROM locations WHERE user_id = ? AND timestamp < DATE_SUB(NOW(), INTERVAL 1 HOUR)",
            [userId],
        )

        // 새 위치 저장
        const [result] = await connection.execute(
            "INSERT INTO locations (user_id, latitude, longitude) VALUES (?, ?, ?)",
            [userId, lat, lng],
        )

        res.json({
            success: true,
            message: "Location updated successfully",
            data: {
                id: result.insertId,
                userId,
                latitude: lat,
                longitude: lng,
            },
        })
    } catch (error) {
        console.error("Error updating location:", error)
        res.status(500).json({ error: "Failed to update location" })
    } finally {
        connection.release()
    }
})

// 모든 사용자의 최신 위치 조회
app.get("/api/locations/:userId", async (req, res) => {
  const { userId } = req.params;
  const connection = await pool.getConnection();

  try {
    // 1) 나의 최신 위치 1개 (시간 제한 없음)
    const [meRows] = await connection.execute(
      `
      SELECT
        user_id AS id,
        latitude,
        longitude,
        timestamp
      FROM locations
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
      `,
      [userId]
    );

    // 2) 타인의 최근 30분 이내 "각 유저의 최신 위치" 중, 최신순 최대 10명
    const [otherRows] = await connection.execute(
      `
      SELECT
        l.user_id AS id,
        l.latitude,
        l.longitude,
        l.timestamp
      FROM locations l
      JOIN (
        SELECT user_id, MAX(timestamp) AS max_ts
        FROM locations
        WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
          AND user_id <> ?
        GROUP BY user_id
      ) latest
        ON l.user_id = latest.user_id
       AND l.timestamp = latest.max_ts
      ORDER BY l.timestamp DESC
      LIMIT 10
      `,
      [userId]
    );

    // 3) 나 + 타인 최대 10명 합치기
    const rows = [...meRows, ...otherRows];

    res.json({
      success: true,
      count: rows.length,
      data: rows.map((row) => ({
        id: row.id,
        lat: Number.parseFloat(row.latitude),
        lng: Number.parseFloat(row.longitude),
        timestamp: row.timestamp,
      })),
    });
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({ error: "Failed to fetch locations" });
  } finally {
    connection.release();
  }
});


// 서버 시작
async function startServer() {
    try {
        await initializeDatabase()
        app.listen(PORT, () => {
            console.log(`GPS Sharing API Server running on http://localhost:${PORT}`)
        })
    } catch (error) {
        console.error("Failed to start server:", error)
        process.exit(1)
    }
}

startServer()

// 프로세스 종료 시 연결 정리
process.on("SIGINT", async () => {
    console.log("Shutting down gracefully...")
    await pool.end()
    process.exit(0)
})
