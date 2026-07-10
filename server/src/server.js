import "dotenv/config";
import cors from "cors";
import express from "express";

const app = express();

const PORT = process.env.PORT || 3001;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";

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

function getOpenRouterHeaders() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY отсутствует в файле server/.env",
    );
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:5173",
    "X-Title": "AI Video Studio",
  };
}

async function readOpenRouterError(openRouterResponse) {
  const responseText = await openRouterResponse.text();

  try {
    const parsedResponse = JSON.parse(responseText);

    return (
      parsedResponse?.error?.message ||
      parsedResponse?.message ||
      responseText ||
      "Неизвестная ошибка OpenRouter"
    );
  } catch {
    return responseText || "Неизвестная ошибка OpenRouter";
  }
}

/*
  Проверка нашего сервера
*/
app.get("/api/health", (request, response) => {
  response.json({
    success: true,
    message: "Сервер работает",
  });
});

/*
  Получение видеомоделей
*/
app.get("/api/video/models", async (request, response) => {
  try {
    const openRouterResponse = await fetch(
      `${OPENROUTER_API_URL}/videos/models`,
      {
        headers: getOpenRouterHeaders(),
      },
    );

    if (!openRouterResponse.ok) {
      const message = await readOpenRouterError(
        openRouterResponse,
      );

      return response.status(openRouterResponse.status).json({
        success: false,
        message,
      });
    }

    const data = await openRouterResponse.json();

    response.json({
      success: true,
      models: Array.isArray(data.data) ? data.data : [],
    });
  } catch (error) {
    console.error("Models error:", error);

    response.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/*
  Запуск реальной генерации видео
*/
app.post("/api/video/generate", async (request, response) => {
  try {
    const {
      model,
      prompt,
      aspectRatio,
      duration,
      resolution,
      generateAudio,
    } = request.body;

    if (!model || typeof model !== "string") {
      return response.status(400).json({
        success: false,
        message: "Модель не выбрана",
      });
    }

    if (!prompt || !prompt.trim()) {
      return response.status(400).json({
        success: false,
        message: "Введите описание видео",
      });
    }

    const requestBody = {
      model,
      prompt: prompt.trim(),
      aspect_ratio: aspectRatio,
      duration: Number(duration),
      resolution,
      generate_audio: Boolean(generateAudio),
    };

    console.log("Создание видео:", {
      ...requestBody,
      prompt: `${requestBody.prompt.slice(0, 80)}...`,
    });

    const openRouterResponse = await fetch(
      `${OPENROUTER_API_URL}/videos`,
      {
        method: "POST",
        headers: getOpenRouterHeaders(),
        body: JSON.stringify(requestBody),
      },
    );

    if (!openRouterResponse.ok) {
      const message = await readOpenRouterError(
        openRouterResponse,
      );

      console.error("OpenRouter generation error:", message);

      return response.status(openRouterResponse.status).json({
        success: false,
        message,
      });
    }

    const job = await openRouterResponse.json();

    response.status(202).json({
      success: true,
      job,
    });
  } catch (error) {
    console.error("Generate video error:", error);

    response.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/*
  Проверка статуса генерации
*/
app.get("/api/video/status/:jobId", async (request, response) => {
  try {
    const { jobId } = request.params;

    if (!jobId) {
      return response.status(400).json({
        success: false,
        message: "Отсутствует jobId",
      });
    }

    const openRouterResponse = await fetch(
      `${OPENROUTER_API_URL}/videos/${encodeURIComponent(jobId)}`,
      {
        headers: getOpenRouterHeaders(),
      },
    );

    if (!openRouterResponse.ok) {
      const message = await readOpenRouterError(
        openRouterResponse,
      );

      return response.status(openRouterResponse.status).json({
        success: false,
        message,
      });
    }

    const job = await openRouterResponse.json();

    response.json({
      success: true,
      job,
    });
  } catch (error) {
    console.error("Video status error:", error);

    response.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/*
  Получение готового видео.
  React обращается к нашему серверу, поэтому API-ключ
  никогда не попадает в браузер.
*/
app.get("/api/video/content/:jobId", async (request, response) => {
  try {
    const { jobId } = request.params;

    const openRouterResponse = await fetch(
      `${OPENROUTER_API_URL}/videos/${encodeURIComponent(
        jobId,
      )}/content?index=0`,
      {
        headers: getOpenRouterHeaders(),
      },
    );

    if (!openRouterResponse.ok) {
      const message = await readOpenRouterError(
        openRouterResponse,
      );

      return response.status(openRouterResponse.status).json({
        success: false,
        message,
      });
    }

    const contentType =
      openRouterResponse.headers.get("content-type") ||
      "video/mp4";

    const contentLength =
      openRouterResponse.headers.get("content-length");

    response.setHeader("Content-Type", contentType);
    response.setHeader(
      "Content-Disposition",
      `inline; filename="generated-video-${jobId}.mp4"`,
    );

    if (contentLength) {
      response.setHeader("Content-Length", contentLength);
    }

    const videoBuffer = Buffer.from(
      await openRouterResponse.arrayBuffer(),
    );

    response.send(videoBuffer);
  } catch (error) {
    console.error("Video content error:", error);

    response.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.use((request, response) => {
  response.status(404).json({
    success: false,
    message: "Маршрут не найден",
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});