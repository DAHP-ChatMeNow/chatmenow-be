let notificationIo = null;

function setNotificationIo(io) {
  notificationIo = io;
}

function emitNotificationToUser(userId, payload) {
  if (!notificationIo || !userId || !payload) {
    return;
  }

  notificationIo.to(String(userId)).emit("notification:new", payload);
  notificationIo.to(String(userId)).emit("notification", payload);
}

module.exports = {
  setNotificationIo,
  emitNotificationToUser,
};
