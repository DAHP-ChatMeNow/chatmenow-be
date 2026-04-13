const reelService = require("../service/reel.service");

exports.createReel = async (req, res) => {
    try {
        const userId = req.user.userId;

        // videoKey should be the S3 key that the client already uploaded via presigned URL
        const { videoKey, caption, musicUrl, musicTitle, musicArtist } = req.body;

        if (!videoKey) {
            return res.status(400).json({ message: "videoKey là bắt buộc" });
        }

        const reel = await reelService.createReel(userId, { caption, musicUrl, musicTitle, musicArtist }, videoKey);

        return res.status(201).json({ success: true, reel });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};

exports.getReelFeed = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { cursor, limit } = req.query;

        const result = await reelService.getReelFeed(userId, {
            cursor: cursor || null,
            limit: limit ? parseInt(limit, 10) : undefined,
        });

        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};

exports.getReelById = async (req, res) => {
    try {
        const reel = await reelService.getReelById(req.user.userId, req.params.id);
        return res.status(200).json({ success: true, reel });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};

exports.getMyReels = async (req, res) => {
    try {
        const { cursor, limit } = req.query;
        const result = await reelService.getMyReels(req.user.userId, {
            cursor: cursor || null,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};

exports.toggleLike = async (req, res) => {
    try {
        const result = await reelService.toggleLike(req.user.userId, req.params.id);
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};

exports.addComment = async (req, res) => {
    try {
        const comment = await reelService.addComment(req.user.userId, req.params.id, req.body);
        return res.status(201).json({ success: true, comment });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};

exports.getComments = async (req, res) => {
    try {
        const { cursor, limit } = req.query;
        const result = await reelService.getComments(req.params.id, {
            cursor: cursor || null,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};

exports.deleteReel = async (req, res) => {
    try {
        const result = await reelService.deleteReel(req.user.userId, req.params.id);
        return res.status(200).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};

exports.incrementView = async (req, res) => {
    try {
        const result = await reelService.incrementView(req.params.id);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};
