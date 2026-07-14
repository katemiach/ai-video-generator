
import express from "express";
import multer from "multer";

const router = express.Router();

const ATLAS_BASE_URL = "https://api.atlascloud.ai/api/v1";

/*
  Модели, которые будут отображаться на сайте.

  Wan 2.5 Fast:
  - быстрее и обычно дешевле;
  - 5 или 10 секунд;
  - 720p или 1080p.

  Wan 2.5:
  - обычная версия;
  - 5 или 10 секунд;
  - 480p, 720p или 1080p;
  - может генерировать звук.
*/
const VIDEO_MODELS = [
    {
    id: "atlascloud/wan-2.2-turbo-spicy/image-to-video",
    name: "Wan 2.2 Turbo Spicy — дешевле",
    description:
        "Недорогая модель для оживления изображения. Поддерживает 5 или 8 секунд.",
    supported_aspect_ratios: ["16:9", "9:16", "1:1"],
    supported_durations: [5, 8],
    supported_resolutions: ["480p", "720p", "1080p"],
    generate_audio: false,
    },
  {
    id: "alibaba/wan-2.5/image-to-video",
    name: "Wan 2.5 — качество",
    description:
      "Обычная версия Wan 2.5 с поддержкой разрешения до 1080p и генерации звука.",
    supported_aspect_ratios: ["16:9", "9:16", "1:1"],
    supported_durations: [5, 10],
    supported_resolutions: ["480p", "720p", "1080p"],
    generate_audio: true,
  },
  {
  id: "atlascloud/wan-2.2-turbo-spicy/image-to-video",
  name: "Wan 2.2 Turbo Spicy — дешевле",
  description:
    "Недорогая модель для оживления изображения. Поддерживает видео на 5 или 8 секунд.",
  supported_aspect_ratios: ["16:9", "9:16", "1:1"],
  supported_durations: [5, 8],
  supported_resolutions: ["480p", "720p", "1080p"],
  generate_audio: false,
},
];

/*
  Multer принимает изображение из React.

  Файл временно хранится в оперативной памяти,
  после чего отправляется в AtlasCloud.
*/
const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 20 * 1024 * 1024,
  },

  fileFilter: (_request, file, callback) => {
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(
        new Error(
          "Разрешены только изображения PNG, JPG, JPEG и WEBP",
        ),
      );

      return;
    }

    callback(null, true);
  },
});

/*
  Получаем API-ключ только из серверного .env.
*/
function getApiKey() {
  const apiKey = process.env.ATLASCLOUD_API_KEY;

  if (!apiKey) {
    throw new Error(
      "В серверном файле .env не указан ATLASCLOUD_API_KEY",
    );
  }

  return apiKey;
}

/*
  Безопасное чтение ответа AtlasCloud.
*/
async function readResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text,
    };
  }
}

/*
  Извлекаем понятное сообщение об ошибке.
*/
function getErrorMessage(data, fallbackMessage) {
  if (typeof data?.error === "string") {
    return data.error;
  }

  return (
    data?.message ||
    data?.detail ||
    data?.error?.message ||
    data?.data?.error ||
    fallbackMessage
  );
}

/*
  Ответ AtlasCloud иногда может содержать данные
  внутри data, а иногда сразу в корне объекта.
*/
function normalizeJob(rawData) {
  const prediction = rawData?.data || rawData || {};

  return {
    id:
      prediction.id ||
      prediction.prediction_id ||
      prediction.request_id ||
      null,

    status: String(
      prediction.status ||
        prediction.state ||
        "processing",
    ).toLowerCase(),

    outputs:
      prediction.outputs ||
      prediction.output ||
      [],

    error:
      prediction.error ||
      prediction.failure_reason ||
      null,

    usage:
      prediction.usage ||
      rawData?.usage ||
      null,

    model:
      prediction.model ||
      null,
  };
}

/*
  AtlasCloud может вернуть:

  outputs: ["https://...video.mp4"]

  или:

  outputs: [
    {
      url: "https://...video.mp4"
    }
  ]
*/
function extractVideoUrl(outputs) {
  if (!outputs) {
    return null;
  }

  if (typeof outputs === "string") {
    return outputs;
  }

  if (!Array.isArray(outputs)) {
    return (
      outputs.url ||
      outputs.video_url ||
      outputs.videoUrl ||
      outputs.video?.url ||
      null
    );
  }

  for (const output of outputs) {
    if (typeof output === "string") {
      return output;
    }

    if (output && typeof output === "object") {
      const url =
        output.url ||
        output.video_url ||
        output.videoUrl ||
        output.video?.url;

      if (url) {
        return url;
      }
    }
  }

  return null;
}
function findUrlInResponse(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value === "string" &&
    /^https?:\/\//i.test(value)
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const foundUrl = findUrlInResponse(item);

      if (foundUrl) {
        return foundUrl;
      }
    }

    return null;
  }

  if (typeof value === "object") {
    const preferredKeys = [
      "url",
      "file_url",
      "fileUrl",
      "image_url",
      "imageUrl",
      "media_url",
      "mediaUrl",
      "download_url",
      "downloadUrl",
      "uri",
      "location",
    ];

    for (const key of preferredKeys) {
      const foundUrl = findUrlInResponse(value[key]);

      if (foundUrl) {
        return foundUrl;
      }
    }

    for (const nestedValue of Object.values(value)) {
      const foundUrl = findUrlInResponse(nestedValue);

      if (foundUrl) {
        return foundUrl;
      }
    }
  }

  return null;
}
/*
  Шаг 1:
  загружаем локальное изображение в AtlasCloud
  и получаем временную ссылку.
*/
async function uploadImageToAtlasCloud(file) {
  const formData = new FormData();

  const imageBlob = new Blob([file.buffer], {
    type: file.mimetype,
  });

  formData.append(
    "file",
    imageBlob,
    file.originalname || "image.png",
  );

  const response = await fetch(
    `${ATLAS_BASE_URL}/model/uploadMedia`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: formData,
    },
  );

  const data = await readResponse(response);

  console.log("===== ATLASCLOUD UPLOAD RESPONSE =====");
  console.dir(data, {
    depth: null,
    colors: true,
  });
  console.log("======================================");

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        data,
        `Не удалось загрузить изображение. Код: ${response.status}`,
      ),
    );
  }

  const imageUrl = findUrlInResponse(data);

  if (!imageUrl) {
    throw new Error(
      "AtlasCloud не вернул доступную ссылку на изображение. Скопируйте ответ из терминала после ATLASCLOUD UPLOAD RESPONSE.",
    );
  }

  console.log(
    "AtlasCloud image URL found:",
    imageUrl,
  );

  return imageUrl;
}

/*
  Формируем параметры для выбранной модели.
*/
function buildGenerationPayload({
  selectedModel,
  imageUrl,
  prompt,
  duration,
  resolution,
  generateAudio,
}) {
  /*
    Отдельные параметры для дешёвой Wan 2.2 Turbo.
  */
  if (
    selectedModel.id ===
    "atlascloud/wan-2.2-turbo-spicy/image-to-video"
  ) {
    return {
      model: selectedModel.id,
      image: imageUrl,
      prompt,
      duration,
      resolution,
      seed: -1,
    };
  }

  /*
    Параметры для Wan 2.5.
  */
  const basePayload = {
    model: selectedModel.id,
    image: imageUrl,
    prompt,
    duration,
    resolution,
    seed: -1,
    enable_prompt_expansion: false,

    negative_prompt:
      "distorted face, deformed body, extra limbs, duplicate character, changing clothes, changing colors, flickering, frame warping, blurry image, text, subtitles, logo, watermark",
  };

  /*
    Генерацию звука отправляем только для обычной Wan 2.5.
  */
  if (
    selectedModel.id ===
    "alibaba/wan-2.5/image-to-video"
  ) {
    return {
      ...basePayload,
      generate_audio: Boolean(generateAudio),
    };
  }

  return basePayload;
}

/*
  Получение текущего статуса генерации.
*/
async function getPrediction(jobId) {
  const response = await fetch(
    `${ATLAS_BASE_URL}/model/prediction/${encodeURIComponent(
      jobId,
    )}`,
    {
      method: "GET",

      headers: {
        Authorization: `Bearer ${getApiKey()}`,
      },
    },
  );

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        data,
        `Не удалось получить статус. Код: ${response.status}`,
      ),
    );
  }

  return normalizeJob(data);
}

/*
  GET /api/video/models

  Отдаёт список доступных моделей в React.
*/
router.get("/models", (_request, response) => {
  response.json({
    success: true,
    models: VIDEO_MODELS,
  });
});

/*
  POST /api/video/generate

  Принимает:
  - image;
  - model;
  - prompt;
  - duration;
  - resolution;
  - generateAudio.
*/
router.post(
  "/generate",
  upload.single("image"),

  async (request, response) => {
    try {
      if (!request.file) {
        response.status(400).json({
          success: false,
          message:
            "Сначала загрузите изображение, которое нужно оживить",
        });

        return;
      }

      const modelId = String(
        request.body.model || "",
      );

      const selectedModel = VIDEO_MODELS.find(
        (item) => item.id === modelId,
      );

      if (!selectedModel) {
        response.status(400).json({
          success: false,
          message:
            "Выбрана неизвестная или неподдерживаемая модель",
        });

        return;
      }

      const prompt = String(
        request.body.prompt || "",
      ).trim();

      if (!prompt) {
        response.status(400).json({
          success: false,
          message:
            "Введите описание движения персонажа и камеры",
        });

        return;
      }

      const duration = Number(
        request.body.duration,
      );

      if (
        !selectedModel.supported_durations.includes(
          duration,
        )
      ) {
        response.status(400).json({
          success: false,
          message:
            `Для этой модели можно выбрать только: ` +
            `${selectedModel.supported_durations.join(
              " или ",
            )} секунд`,
        });

        return;
      }

      const resolution = String(
        request.body.resolution ||
          selectedModel.supported_resolutions[0],
      );

      if (
        !selectedModel.supported_resolutions.includes(
          resolution,
        )
      ) {
        response.status(400).json({
          success: false,
          message:
            `Модель ${selectedModel.name} ` +
            `не поддерживает разрешение ${resolution}`,
        });

        return;
      }

      const generateAudio =
        String(request.body.generateAudio) === "true";

      /*
        Загружаем изображение в AtlasCloud.
      */
      const imageUrl =
        await uploadImageToAtlasCloud(
          request.file,
        );

      /*
        Формируем тело запроса.
      */
      const payload = buildGenerationPayload({
        selectedModel,
        imageUrl,
        prompt,
        duration,
        resolution,
        generateAudio:
          selectedModel.generate_audio &&
          generateAudio,
      });

      console.log(
        "AtlasCloud generation request:",
        {
          ...payload,
        image: "[uploaded image URL]",
        },
      );

      /*
        Запускаем генерацию видео.
      */
      const atlasResponse = await fetch(
        `${ATLAS_BASE_URL}/model/generateVideo`,
        {
          method: "POST",

          headers: {
            Authorization: `Bearer ${getApiKey()}`,
            "Content-Type": "application/json",
          },

          body: JSON.stringify(payload),
        },
      );

      const atlasData =
        await readResponse(atlasResponse);

      if (!atlasResponse.ok) {
        throw new Error(
          getErrorMessage(
            atlasData,
            `AtlasCloud не запустил генерацию. Код: ${atlasResponse.status}`,
          ),
        );
      }

      const createdJob =
        normalizeJob(atlasData);

      if (!createdJob.id) {
        console.error(
          "Неизвестный ответ generateVideo:",
          atlasData,
        );

        throw new Error(
          "AtlasCloud не вернул ID задания",
        );
      }

      response.json({
        success: true,
        job: createdJob,
      });
    } catch (error) {
      console.error(
        "AtlasCloud generate error:",
        error,
      );

      response.status(500).json({
        success: false,
        message:
          error.message ||
          "Не удалось запустить генерацию видео",
      });
    }
  },
);

/*
  GET /api/video/status/:jobId

  React вызывает этот адрес каждые несколько секунд.
*/
router.get(
  "/status/:jobId",

  async (request, response) => {
    try {
      const jobId = String(
        request.params.jobId || "",
      );

      if (!jobId) {
        response.status(400).json({
          success: false,
          message:
            "Не указан идентификатор задания",
        });

        return;
      }

      const job = await getPrediction(jobId);

      response.json({
        success: true,
        job,
      });
    } catch (error) {
      console.error(
        "AtlasCloud status error:",
        error,
      );

      response.status(500).json({
        success: false,
        message:
          error.message ||
          "Не удалось проверить статус видео",
      });
    }
  },
);

/*
  GET /api/video/content/:jobId

  После завершения скачиваем видео с AtlasCloud
  и передаём его в React.
*/
router.get(
  "/content/:jobId",

  async (request, response) => {
    try {
      const jobId = String(
        request.params.jobId || "",
      );

      const job = await getPrediction(jobId);

      if (job.status !== "completed") {
        response.status(409).json({
          success: false,
          message:
            `Видео ещё не готово. Текущий статус: ${job.status}`,
        });

        return;
      }

      const videoUrl =
        extractVideoUrl(job.outputs);

      if (!videoUrl) {
        console.error(
          "AtlasCloud outputs:",
          job.outputs,
        );

        throw new Error(
          "AtlasCloud завершил генерацию, но не вернул ссылку на видео",
        );
      }

      const videoResponse = await fetch(
        videoUrl,
      );

      if (!videoResponse.ok) {
        throw new Error(
          `Не удалось скачать готовое видео. Код: ${videoResponse.status}`,
        );
      }

      const videoArrayBuffer =
        await videoResponse.arrayBuffer();

      const videoBuffer = Buffer.from(
        videoArrayBuffer,
      );

      response.setHeader(
        "Content-Type",
        videoResponse.headers.get(
          "content-type",
        ) || "video/mp4",
      );

      response.setHeader(
        "Content-Length",
        videoBuffer.length,
      );

      response.setHeader(
        "Content-Disposition",
        `inline; filename="generated-${jobId}.mp4"`,
      );

      response.send(videoBuffer);
    } catch (error) {
      console.error(
        "AtlasCloud content error:",
        error,
      );

      response.status(500).json({
        success: false,
        message:
          error.message ||
          "Не удалось получить готовое видео",
      });
    }
  },
);

/*
  Обработка ошибок загрузки изображения.
*/
router.use(
  (
    error,
    _request,
    response,
    _next,
  ) => {
    if (error instanceof multer.MulterError) {
      response.status(400).json({
        success: false,

        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "Размер изображения не должен превышать 20 МБ"
            : error.message,
      });

      return;
    }

    response.status(400).json({
      success: false,
      message:
        error.message ||
        "Ошибка загрузки изображения",
    });
  },
);

export default router;