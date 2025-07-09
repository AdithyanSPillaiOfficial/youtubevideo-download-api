const express = require("express");
const fs = require("fs");
const ytdl = require("@distube/ytdl-core");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");

const app = express();
const port = 3000;

//app.use(express.static(path.join(__dirname, 'videos')));
function removeAllFilesSync(directory) {
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const filePath = path.join(directory, file);
    fs.unlinkSync(filePath);
  }
}
removeAllFilesSync("videos")
removeAllFilesSync("temp");
let downloaded = [];

function cachingProvider(videoId, req, res) {
  if (downloaded.includes(videoId)) {
    const outputPath = `videos/output_${videoId}.mp4`;

    // res.setHeader("Content-Type", "video/mp4");
    // res.setHeader("Content-Disposition", `inline; filename="${videoId}.mp4"`);
    // const stream = fs.createReadStream(outputPath);
    // stream.pipe(res);

    // // Cleanup after stream ends
    // stream.on("close", () => {
    //     // fs.unlinkSync(videoPath);
    //     // fs.unlinkSync(audioPath);
    //     // fs.unlinkSync(outputPath); // Optional: only if you don't need to cache it
    // });

    if (!fs.existsSync(outputPath)) {
      return res.status(404).send("Video not found");
    }

    const stat = fs.statSync(outputPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Parse Range header (e.g., bytes=12345-)
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send("Requested range not satisfiable\n");
        return;
      }

      const chunkSize = end - start + 1;
      const file = fs.createReadStream(outputPath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "video/mp4",
      });

      file.pipe(res);
    } else {
      // No range header, send entire video
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4",
      });

      fs.createReadStream(outputPath).pipe(res);
    }

    return true;
  } else {
    return false;
  }
}

app.get("/download", async (req, res) => {
  const videoUrl = req.query.url;
  //res.setHeader("Content-Type", "video/mp4");

  console.log("Received Request to Download video : ", videoUrl);

  if (!videoUrl || !ytdl.validateURL(videoUrl)) {
    return res.status(400).json({ error: "Invalid or missing YouTube URL" });
  }

  const videoId = ytdl.getURLVideoID(videoUrl);

  if (cachingProvider(videoId, req, res)) {
    return;
  }

  const videoPath = `temp/temp_${videoId}_video.mp4`;
  const audioPath = `temp/temp_${videoId}_audio.mp4`;
  const outputPath = `videos/output_${videoId}.mp4`;

  // Map of common quality labels to ytdl video itags
  const QUALITY_ITAGS = {
    "144p": 160,
    "240p": 133,
    "360p": 134,
    "480p": 135,
    "720p": 136,
    "1080p": 137,
    "1440p": 271,
    "2160p": 313,
  };

  // Download video
  ytdl(videoUrl, { quality: req.query.itag || QUALITY_ITAGS[req.query.quality] })
    .on("error", (err) => {
      console.error("ytdl error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to fetch video stream" });
      }
    })
    .pipe(fs.createWriteStream(videoPath))
    .on("finish", () => {
      console.log("Video downloaded");

      // Download audio
      ytdl(videoUrl, { quality: "highestaudio" })
        .pipe(fs.createWriteStream(audioPath))
        .on("finish", () => {
          console.log("Audio downloaded");

          // Merge audio and video
          ffmpeg()
            .input(videoPath)
            .input(audioPath)
            .outputOptions([
              "-c:v copy",
              "-c:a aac",
              "-strict experimental",
              "-shortest",
            ])
            .save(outputPath)
            .on("end", () => {
              console.log("Merge complete");
              downloaded.push(videoId);

              // Send file as download
              //res.download(outputPath, `${videoId}.mp4`, (err) => {
              // Cleanup
              //  fs.unlinkSync(videoPath);
              //  fs.unlinkSync(audioPath);
              //fs.unlinkSync(outputPath);
              //  if (err) console.error("Error sending file:", err);
              //});
              // res.setHeader("Content-Disposition", `inline; filename="${videoId}.mp4"`);
              // const stream = fs.createReadStream(outputPath);
              // stream.pipe(res);

              //stream video to client

              if (!fs.existsSync(outputPath)) {
                return res.status(404).send("Video not found");
              }

              const stat = fs.statSync(outputPath);
              const fileSize = stat.size;
              const range = req.headers.range;

              if (range) {
                // Parse Range header (e.g., bytes=12345-)
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                if (start >= fileSize) {
                  res.status(416).send("Requested range not satisfiable\n");
                  return;
                }

                const chunkSize = end - start + 1;
                const file = fs.createReadStream(outputPath, { start, end });

                res.writeHead(206, {
                  "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                  "Accept-Ranges": "bytes",
                  "Content-Length": chunkSize,
                  "Content-Type": "video/mp4",
                });

                file.pipe(res);

                file.on("close", () => {
                  fs.unlinkSync(videoPath);
                  fs.unlinkSync(audioPath);
                  // fs.unlinkSync(outputPath); // Optional: only if you don't need to cache it
                });
              } else {
                // No range header, send entire video
                res.writeHead(200, {
                  "Content-Length": fileSize,
                  "Content-Type": "video/mp4",
                });

                fs.createReadStream(outputPath).pipe(res);
              }

              // Cleanup after stream ends
              //stream.on("close", () => {
              // file.on("close", () => {
              //   fs.unlinkSync(videoPath);
              //   fs.unlinkSync(audioPath);
              //   // fs.unlinkSync(outputPath); // Optional: only if you don't need to cache it
              // });
            })
            .on("error", (err) => {
              console.error("FFmpeg error:", err);
              res
                .status(500)
                .json({ error: "Failed to merge video and audio" });
            });
        });
    });
});


app.get("/details", async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !ytdl.validateURL(videoUrl)) {
    return res.status(400).json({ error: "Invalid or missing YouTube URL" });
  }
  const videoId = ytdl.getURLVideoID(videoUrl);
  const videoInfo = await ytdl.getInfo(videoUrl);
  const videoDetails = videoInfo.videoDetails;
  const videoFormats = videoInfo.formats;
  const videoDetailsJson = {
    videoId: videoId,
    videoDetails: videoDetails,
    videoFormats: videoFormats,
  };
  res.json(videoDetailsJson);
})


//audio streaming route
app.get("/audio", async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !ytdl.validateURL(videoUrl)) {
    return res.status(400).json({ error: "Invalid or missing YouTube URL" });
  }

  console.log("Received Request to Download audio : ", videoUrl)
  const videoId = ytdl.getURLVideoID(videoUrl);
  const audioPath = `temp/temp_${videoId}_audio.mp4`;

  ytdl(videoUrl, { quality: "highestaudio" })
  .pipe(fs.createWriteStream(audioPath))
  .on("finish", () => {
    console.log("Audio downloaded");

    
    const stat = fs.statSync(audioPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Handle Range requests
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send('Requested range not satisfiable\n');
        return;
      }

      const chunkSize = end - start + 1;
      const file = fs.createReadStream(audioPath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg',
      });

      file.pipe(res);
    } else {
      // Send full file if no Range header
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
      });

      fs.createReadStream(audioPath).pipe(res);
    }

  })
})

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
