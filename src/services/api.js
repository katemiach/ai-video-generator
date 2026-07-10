import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:3001/api",
  timeout: 120000,
});

export function getErrorMessage(error) {
  return (
    error.response?.data?.message ||
    error.message ||
    "Произошла неизвестная ошибка"
  );
}

export default api;