import "dotenv/config";
import cors from "cors";
import express from "express";
import atlasCloudVideoRoutes from "../routes/atlasCloudVideoRoutes.js";

const app = express();

const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: "http://localhost:5173",
  }),
);

app.use(
  express.json({
    limit: "20mb",
  }),
);

/*
  Проверка работы сервера
*/
app.get("/api/health", (_request, response) => {
  response.json({
    success: true,
    message: "Сервер работает",
  });
});

/*
  Все маршруты AtlasCloud:

  GET  /api/video/models
  POST /api/video/generate
  GET  /api/video/status/:jobId
  GET  /api/video/content/:jobId
*/
app.use("/api/video", atlasCloudVideoRoutes);

/*
  Маршрут должен находиться после всех остальных.
*/
app.use((_request, response) => {
  response.status(404).json({
    success: false,
    message: "Маршрут не найден",
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});