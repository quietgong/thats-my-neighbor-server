const express = require("express")
const mysql = require("mysql2/promise")
const app = express()
const PORT = 3333;

// 미들웨어
app.use(express.json())

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
        // users 테이블 생성
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(36) PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        `)

        // locations 테이블 생성
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS locations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            latitude DECIMAL(10, 8) NOT NULL,
            longitude DECIMAL(11, 8) NOT NULL,
            accuracy FLOAT,
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
    const {userId, latitude, longitude, accuracy} = req.body

    // 입력값 검증
    if (!userId || !latitude || !longitude || typeof latitude !== "number" || typeof longitude !== "number") {
        return res.status(400).json({error: "Invalid input parameters"})
    }

    const connection = await pool.getConnection()
    try {
        // 사용자가 존재하지 않으면 생성
        await connection.execute("INSERT IGNORE INTO users (id) VALUES (?)", [userId])

        // 위치 정보 저장 (최근 한 시간 이상 된 이전 위치는 삭제)
        await connection.execute("DELETE FROM locations WHERE user_id = ? AND timestamp < DATE_SUB(NOW(), INTERVAL 1 HOUR)", [userId])

        // 새 위치 저장
        const [result] = await connection.execute(
            "INSERT INTO locations (user_id, latitude, longitude, accuracy) VALUES (?, ?, ?, ?)",
            [userId, latitude, longitude, accuracy || null],
        )

        res.json({
            success: true,
            message: "Location updated successfully",
            data: {
                id: result.insertId,
                userId,
                latitude,
                longitude,
                accuracy,
            },
        })
    } catch (error) {
        console.error("Error updating location:", error)
        res.status(500).json({error: "Failed to update location"})
    } finally {
        connection.release()
    }
})

// 모든 사용자의 최신 위치 조회
app.get("/api/locations", async (req, res) => {
    const connection = await pool.getConnection()
    try {
        // 각 사용자의 가장 최신 위치만 조회
        const [rows] = await connection.execute(`
            SELECT u.id,
                   u.username,
                   l.latitude,
                   l.longitude,
                   l.accuracy,
                   l.timestamp
            FROM users u
                     LEFT JOIN (SELECT user_id, latitude, longitude, accuracy, timestamp
                                FROM locations
                                WHERE (user_id
                                    , timestamp) IN (
                                    SELECT user_id
                                    , MAX (timestamp)
                                    FROM locations
                                    WHERE timestamp
                                    > DATE_SUB(NOW()
                                    , INTERVAL 30 MINUTE)
                                    GROUP BY user_id
                                    )) l ON u.id = l.user_id
            WHERE l.latitude IS NOT NULL
            ORDER BY l.timestamp DESC
        `)

        res.json({
            success: true,
            count: rows.length,
            data: rows.map((row) => ({
                userId: row.id,
                username: row.username,
                latitude: Number.parseFloat(row.latitude),
                longitude: Number.parseFloat(row.longitude),
                accuracy: row.accuracy,
                timestamp: row.timestamp,
            })),
        })
    } catch (error) {
        console.error("Error fetching locations:", error)
        res.status(500).json({error: "Failed to fetch locations"})
    } finally {
        connection.release()
    }
})

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
