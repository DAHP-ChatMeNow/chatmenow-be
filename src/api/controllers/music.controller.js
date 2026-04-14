const musicService = require("../service/music.service");

exports.search = async (req, res) => {
    try {
        const { q = "", limit } = req.query;
        const tracks = await musicService.search(q, limit ? parseInt(limit, 10) : 20);
        return res.status(200).json({ success: true, tracks });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};

exports.getPopular = async (req, res) => {
    try {
        const { limit } = req.query;
        const tracks = await musicService.getPopular(limit ? parseInt(limit, 10) : 20);
        return res.status(200).json({ success: true, tracks });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: error.message });
    }
};
