const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const REQUEST_TIMEOUT_MS = 10000;

function createTurnstileError(statusCode, code, message, detail) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (detail) {
    error.detail = detail;
  }
  return error;
}

async function verifyTurnstile({ token, remoteIp }) {
  const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    throw createTurnstileError(
      500,
      "TURNSTILE_SECRET_MISSING",
      "Thiếu cấu hình CLOUDFLARE_TURNSTILE_SECRET_KEY trên server.",
    );
  }

  if (!token || typeof token !== "string") {
    throw createTurnstileError(
      400,
      "TURNSTILE_TOKEN_MISSING",
      "Thiếu turnstileToken hoặc định dạng không hợp lệ.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);

    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createTurnstileError(
        502,
        "TURNSTILE_UPSTREAM_ERROR",
        "Không thể xác thực Turnstile do lỗi từ Cloudflare.",
      );
    }

    const result = await response.json();

    if (!result.success) {
      throw createTurnstileError(
        401,
        "TURNSTILE_INVALID",
        "Xác thực Turnstile không hợp lệ hoặc đã hết hạn.",
        {
          errorCodes: result["error-codes"] || [],
        },
      );
    }

    return result;
  } catch (error) {
    if (error.name === "AbortError") {
      throw createTurnstileError(
        504,
        "TURNSTILE_TIMEOUT",
        "Hết thời gian chờ khi xác thực Turnstile.",
      );
    }

    if (error.statusCode) {
      throw error;
    }

    throw createTurnstileError(
      502,
      "TURNSTILE_VERIFY_FAILED",
      "Không thể kết nối Cloudflare để xác thực Turnstile.",
      error.message,
    );
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  verifyTurnstile,
};
