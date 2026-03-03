const chatService = require("../service/chat.service");

exports.getConversations = async (req, res) => {
  try {
    const conversations = await chatService.getConversations(req.user.userId);

    res.json({
      success: true,
      conversations,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit, beforeId } = req.query;

    const result = await chatService.getMessages(conversationId, {
      limit,
      beforeId,
    });

    res.status(200).json({
      success: true,
      messages: result.messages,
      total: result.total,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const message = await chatService.sendMessage(senderId, req.body);

    res.status(201).json(message);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.createGroupConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const group = await chatService.createGroupConversation(userId, req.body);

    res.status(201).json({ success: true, group });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getConversationDetails = async (req, res) => {
  try {
    const conv = await chatService.getConversationDetails(req.params.id);
    res.status(200).json({ success: true, conversation: conv });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getOrCreatePrivateConversation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { partnerId } = req.params;

    const result = await chatService.getOrCreatePrivateConversation(
      userId,
      partnerId,
    );

    res.status(result.isNew ? 201 : 200).json({
      success: true,
      conversation: result.conversation,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getPrivateConversationPartner = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;

    const partner = await chatService.getPrivateConversationPartner(
      userId,
      conversationId,
    );

    res.status(200).json({
      success: true,
      partner,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.addMemberToGroup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;
    const { memberIds } = req.body;

    const updated = await chatService.addMemberToGroup(
      userId,
      conversationId,
      memberIds,
    );

    res.status(200).json({ success: true, conversation: updated });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.removeMemberFromGroup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId, memberId } = req.params;

    const updated = await chatService.removeMemberFromGroup(
      userId,
      conversationId,
      memberId,
    );

    res.status(200).json({ success: true, conversation: updated });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

// Only admin can dissolve the group, all members will be removed and conversation will be deleted
exports.dissolveGroup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { conversationId } = req.params;

    await chatService.dissolveGroup(userId, conversationId);

    res.status(200).json({ success: true, message: "Đã giải tán nhóm" });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};
