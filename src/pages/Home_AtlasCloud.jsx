import { useEffect, useMemo, useRef, useState } from "react";

const API_URL = "http://localhost:3001/api";

const FINISHED_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "expired",
];

function Home() {
  const [image, setImage] = useState(null);
  const [prompt, setPrompt] = useState("");

  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");

  const [format, setFormat] = useState("16:9");
  const [duration, setDuration] = useState("5");
  const [resolution, setResolution] = useState("720p");
  const [generateAudio, setGenerateAudio] = useState(false);

  const [modelsLoading, setModelsLoading] = useState(true);
  const [videoLoading, setVideoLoading] = useState(false);

  const [job, setJob] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");

  const pollingTimer = useRef(null);
  const videoUrlRef = useRef("");

  /*
    Загружаем модели при открытии сайта
  */
  useEffect(() => {
    loadModels();

    return () => {
      if (pollingTimer.current) {
        clearTimeout(pollingTimer.current);
      }

      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
      }

      if (image?.preview) {
        URL.revokeObjectURL(image.preview);
      }
    };
  }, []);

  async function parseResponse(response) {
    const contentType = response.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      return response.json();
    }

    const text = await response.text();

    return {
      success: false,
      message: text || "Сервер вернул неизвестную ошибку",
    };
  }

  async function loadModels() {
    setModelsLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/video/models`);
      const data = await parseResponse(response);

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Не удалось загрузить модели",
        );
      }

      const receivedModels = Array.isArray(data.models)
        ? data.models
        : [];

      setModels(receivedModels);

      if (receivedModels.length > 0) {
        setModel(receivedModels[0].id);
      }
    } catch (requestError) {
      console.error(requestError);

      setError(
        requestError.message ||
          "Не удалось соединиться с сервером",
      );
    } finally {
      setModelsLoading(false);
    }
  }

  const selectedModel = useMemo(() => {
    return models.find((item) => item.id === model) || null;
  }, [models, model]);

  const availableFormats = useMemo(() => {
    const formats = selectedModel?.supported_aspect_ratios;

    return Array.isArray(formats) && formats.length > 0
      ? formats
      : ["16:9", "9:16", "1:1"];
  }, [selectedModel]);

  const availableDurations = useMemo(() => {
    const durations = selectedModel?.supported_durations;

    return Array.isArray(durations) && durations.length > 0
      ? durations
      : [5, 8, 10];
  }, [selectedModel]);

  const availableResolutions = useMemo(() => {
    const resolutions = selectedModel?.supported_resolutions;

    return Array.isArray(resolutions) && resolutions.length > 0
      ? resolutions
      : ["720p"];
  }, [selectedModel]);

  /*
    При выборе другой модели выставляем её первые
    поддерживаемые параметры.
  */
  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    setFormat(availableFormats[0]);
    setDuration(String(availableDurations[0]));
    setResolution(availableResolutions[0]);
    setGenerateAudio(false);
  }, [
    selectedModel,
    availableFormats,
    availableDurations,
    availableResolutions,
  ]);

  function handleImageUpload(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (image?.preview) {
      URL.revokeObjectURL(image.preview);
    }

    setImage({
      file,
      preview: URL.createObjectURL(file),
    });

    event.target.value = "";
  }

  function removeImage() {
    if (image?.preview) {
      URL.revokeObjectURL(image.preview);
    }

    setImage(null);
  }

  function clearOldVideo() {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = "";
    }

    setVideoUrl("");
  }

  /*
    Запускаем настоящую генерацию
  */
  async function generateVideo() {
    if (!image?.file) {
      setError("Сначала загрузите изображение, которое нужно оживить");
      return;
    }

    if (!prompt.trim()) {
      setError("Введите описание движения и камеры");
      return;
    }

    if (!model) {
      setError("Выберите видеомодель");
      return;
    }

    const estimatedCost =
      selectedModel?.price_per_second !== undefined
        ? Number(selectedModel.price_per_second) * Number(duration)
        : null;

    const confirmed = window.confirm(
      "Оживить загруженное фото?\n\n" +
        `Длительность: ${duration} сек.\n` +
        (estimatedCost !== null
          ? `Ориентировочная стоимость: $${estimatedCost.toFixed(2)}\n`
          : "") +
        "Сумма будет списана с баланса AtlasCloud.",
    );

    if (!confirmed) {
      return;
    }

    if (pollingTimer.current) {
      clearTimeout(pollingTimer.current);
    }

    setError("");
    setJob(null);
    clearOldVideo();
    setVideoLoading(true);

    try {
      const formData = new FormData();

      formData.append("image", image.file);
      formData.append("model", model);
      formData.append("prompt", prompt.trim());
      formData.append("aspectRatio", format);
      formData.append("duration", String(Number(duration)));
      formData.append("resolution", resolution);
      formData.append("generateAudio", String(generateAudio));

      const response = await fetch(
        `${API_URL}/video/generate`,
        {
          method: "POST",
          body: formData,
        },
      );

      const data = await parseResponse(response);

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Не удалось начать генерацию",
        );
      }

      const createdJob = data.job;

      if (!createdJob?.id) {
        throw new Error(
          "AtlasCloud не вернул идентификатор задания",
        );
      }

      setJob(createdJob);

      await pollVideoStatus(createdJob.id);
    } catch (requestError) {
      console.error(requestError);

      setError(
        requestError.message ||
          "Ошибка запуска генерации",
      );

      setVideoLoading(false);
    }
  }

  /*
    Проверяем статус примерно каждые 8 секунд
  */
  async function pollVideoStatus(jobId) {
    try {
      const response = await fetch(
        `${API_URL}/video/status/${encodeURIComponent(jobId)}`,
      );

      const data = await parseResponse(response);

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Не удалось проверить статус",
        );
      }

      const updatedJob = data.job;

      setJob(updatedJob);

      if (updatedJob.status === "completed") {
        await loadGeneratedVideo(jobId);
        setVideoLoading(false);
        return;
      }

      if (FINISHED_STATUSES.includes(updatedJob.status)) {
        throw new Error(
          updatedJob.error ||
            `Генерация завершилась со статусом: ${updatedJob.status}`,
        );
      }

      pollingTimer.current = setTimeout(() => {
        pollVideoStatus(jobId);
      }, 8000);
    } catch (requestError) {
      console.error(requestError);

      setError(
        requestError.message ||
          "Ошибка проверки статуса видео",
      );

      setVideoLoading(false);
    }
  }

  /*
    Загружаем готовые байты MP4
  */
  async function loadGeneratedVideo(jobId) {
    const response = await fetch(
      `${API_URL}/video/content/${encodeURIComponent(jobId)}`,
    );

    if (!response.ok) {
      const data = await parseResponse(response);

      throw new Error(
        data.message || "Не удалось скачать готовое видео",
      );
    }

    const videoBlob = await response.blob();
    const objectUrl = URL.createObjectURL(videoBlob);

    clearOldVideo();

    videoUrlRef.current = objectUrl;
    setVideoUrl(objectUrl);
  }

  function downloadVideo() {
    if (!videoUrl) {
      return;
    }

    const link = document.createElement("a");

    link.href = videoUrl;
    link.download = `generated-video-${job?.id || "result"}.mp4`;

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function getStatusText() {
    switch (job?.status) {
      case "pending":
        return "Задание находится в очереди";
      case "queued":
        return "Задание находится в очереди";
      case "processing":
        return "Модель создаёт видео";
      case "generating":
        return "Модель создаёт видео";
      case "completed":
        return "Видео готово";
      case "failed":
        return "Генерация завершилась ошибкой";
      default:
        return videoLoading
          ? "Подготовка генерации"
          : "Готов к работе";
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI CREATOR</p>
          <h1>AI Video Studio</h1>
        </div>

        <div className="topbar-status">
          <span
            className={`status-dot ${
              videoLoading ? "status-dot-loading" : ""
            }`}
          />

          {getStatusText()}
        </div>
      </header>

      <section className="studio-layout">
        <div className="editor-card">
          <div className="section-block">
            <div className="section-title">
              <span>01</span>

              <div>
                <h2>Изображение персонажа</h2>
                <p>
                  Это изображение станет первым кадром будущего видео
                </p>
              </div>
            </div>

            {!image ? (
              <label className="upload-box">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleImageUpload}
                />

                <div className="upload-icon">+</div>
                <strong>Загрузить изображение</strong>
                <small>PNG, JPG или WEBP</small>
              </label>
            ) : (
              <div className="uploaded-image">
                <img src={image.preview} alt="Персонаж" />

                <button
                  type="button"
                  onClick={removeImage}
                  aria-label="Удалить изображение"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <div className="section-block">
            <div className="section-title">
              <span>02</span>

              <div>
                <h2>Описание видео</h2>
                <p>
                  Опишите сцену, действие, освещение и камеру
                </p>
              </div>
            </div>

            <textarea
              className="main-textarea"
              value={prompt}
              disabled={videoLoading}
              onChange={(event) =>
                setPrompt(event.target.value)
              }
              placeholder="Например: девушка идёт по ночному городу, вокруг неоновые вывески, кинематографическое освещение, камера плавно следует рядом..."
            />

            <div className="character-counter">
              {prompt.length} символов
            </div>
          </div>

          <div className="section-block">
            <div className="section-title">
              <span>03</span>

              <div>
                <h2>Настройки видео</h2>
                <p>
                  Параметры зависят от выбранной модели
                </p>
              </div>
            </div>

            <div className="settings-grid">
              <label className="field">
                <span>Модель</span>

                <select
                  value={model}
                  disabled={
                    modelsLoading ||
                    models.length === 0 ||
                    videoLoading
                  }
                  onChange={(event) =>
                    setModel(event.target.value)
                  }
                >
                  {modelsLoading && (
                    <option value="">
                      Загрузка моделей...
                    </option>
                  )}

                  {models.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name || item.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Формат</span>

                <select
                  value={format}
                  disabled={videoLoading}
                  onChange={(event) =>
                    setFormat(event.target.value)
                  }
                >
                  {availableFormats.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Длительность</span>

                <select
                  value={duration}
                  disabled={videoLoading}
                  onChange={(event) =>
                    setDuration(event.target.value)
                  }
                >
                  {availableDurations.map((item) => (
                    <option value={String(item)} key={item}>
                      {item} сек.
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Разрешение</span>

                <select
                  value={resolution}
                  disabled={videoLoading}
                  onChange={(event) =>
                    setResolution(event.target.value)
                  }
                >
                  {availableResolutions.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedModel?.generate_audio && (
              <label className="audio-checkbox">
                <input
                  type="checkbox"
                  checked={generateAudio}
                  disabled={videoLoading}
                  onChange={(event) =>
                    setGenerateAudio(event.target.checked)
                  }
                />

                <span>Сгенерировать звук вместе с видео</span>
              </label>
            )}

            {selectedModel && (
              <div className="model-information">
                <h3>
                  {selectedModel.name || selectedModel.id}
                </h3>

                <p>
                  {selectedModel.description ||
                    "Описание модели отсутствует."}
                </p>

                {selectedModel.price_per_second !== undefined && (
                  <p>
                    Примерная цена выбранной генерации: $
                    {(
                      Number(selectedModel.price_per_second) *
                      Number(duration)
                    ).toFixed(2)}
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="generation-error">
              <strong>Ошибка</strong>
              <p>{error}</p>
            </div>
          )}

          <button
            type="button"
            className="generate-button"
            disabled={
              videoLoading ||
              modelsLoading ||
              !image?.file ||
              !model ||
              !prompt.trim()
            }
            onClick={generateVideo}
          >
            {videoLoading
              ? `Генерация: ${job?.status || "отправка..."}`
              : `Оживить фото на ${duration} сек.`}
          </button>
        </div>

        <aside className="preview-card">
          <div className="preview-header">
            <div>
              <p>RESULT</p>
              <h2>Результат</h2>
            </div>

            <span>{format}</span>
          </div>

          <div
            className={`video-preview format-${format.replace(
              ":",
              "-",
            )}`}
          >
            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                autoPlay
                playsInline
              />
            ) : image && !videoLoading ? (
              <img
                src={image.preview}
                alt="Предварительный просмотр"
              />
            ) : (
              <div className="preview-empty">
                {videoLoading ? (
                  <>
                    <div className="video-spinner" />

                    <strong>{getStatusText()}</strong>

                    <p>
                      Генерация может занять несколько минут.
                      Не закрывайте страницу.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="play-icon">▶</div>
                    <strong>Здесь появится видео</strong>
                    <p>Введите промпт и запустите генерацию</p>
                  </>
                )}
              </div>
            )}
          </div>

          {job && (
            <div className="job-status">
              <span>Статус задания</span>
              <strong>{job.status}</strong>

              {job.usage?.cost !== undefined && (
                <p>Стоимость: ${job.usage.cost}</p>
              )}
            </div>
          )}

          {videoUrl && (
            <button
              type="button"
              className="download-video-button"
              onClick={downloadVideo}
            >
              Скачать MP4
            </button>
          )}

          <div className="preview-properties">
            <div>
              <span>Модель</span>
              <strong>
                {selectedModel?.name || "Не выбрана"}
              </strong>
            </div>

            <div>
              <span>Длительность</span>
              <strong>{duration} сек.</strong>
            </div>

            <div>
              <span>Разрешение</span>
              <strong>{resolution}</strong>
            </div>

            <div>
              <span>Формат</span>
              <strong>{format}</strong>
            </div>
          </div>

          <div className="prompt-card">
            <span>Промпт</span>

            <p>
              {prompt.trim()
                ? prompt
                : "Описание будущего видео ещё не добавлено."}
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}

export default Home;