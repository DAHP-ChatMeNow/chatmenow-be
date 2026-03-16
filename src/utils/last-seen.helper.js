function formatLastSeen(lastSeen, isOnline = false) {
  if (isOnline) {
    return "Đang hoạt động";
  }

  if (!lastSeen) {
    return "Không xác định";
  }

  const seenDate = new Date(lastSeen);
  if (Number.isNaN(seenDate.getTime())) {
    return "Không xác định";
  }

  const now = new Date();
  const diffMs = now - seenDate;

  if (diffMs < 60 * 1000) {
    return "Vừa truy cập";
  }

  if (diffMs < 60 * 60 * 1000) {
    const minutes = Math.floor(diffMs / (60 * 1000));
    return `${minutes} phút trước`;
  }

  if (diffMs < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    return `${hours} giờ trước`;
  }

  if (diffMs < 48 * 60 * 60 * 1000) {
    return "Hôm qua";
  }

  const day = `${seenDate.getDate()}`.padStart(2, "0");
  const month = `${seenDate.getMonth() + 1}`.padStart(2, "0");
  const year = seenDate.getFullYear();

  return `${day}/${month}/${year}`;
}

module.exports = {
  formatLastSeen,
};
