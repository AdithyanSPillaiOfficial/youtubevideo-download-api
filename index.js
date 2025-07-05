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
//removeAllFilesSync("videos")
let downloaded = ['izbydia9jz4'];

function cachingProvider(videoId, res) {

    if(downloaded.includes(videoId)) {

        const outputPath = `videos/output_${videoId}.mp4`;

        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", `inline; filename="${videoId}.mp4"`);
        const stream = fs.createReadStream(outputPath);
        stream.pipe(res);

        // Cleanup after stream ends
        stream.on("close", () => {
            // fs.unlinkSync(videoPath);
            // fs.unlinkSync(audioPath);
            // fs.unlinkSync(outputPath); // Optional: only if you don't need to cache it
        });

        return true;
    }
    else {
        return false;
    }
}

app.get("/download", async (req, res) => {
  const videoUrl = req.query.url;
  res.setHeader("Content-Type", "video/mp4");

  console.log("Received Request to Download video : ",videoUrl);

  if (!videoUrl || !ytdl.validateURL(videoUrl)) {
    return res.status(400).json({ error: "Invalid or missing YouTube URL" });
  }

  const videoId = ytdl.getURLVideoID(videoUrl);

  if(cachingProvider(videoId, res)){
    return
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
  "1440p": 264,
  "2160p": 266,
};

  // Download video
  ytdl(videoUrl, { quality: QUALITY_ITAGS[req.query.quality] })
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
                res.setHeader("Content-Disposition", `inline; filename="${videoId}.mp4"`);
                const stream = fs.createReadStream(outputPath);
                stream.pipe(res);

                // Cleanup after stream ends
                stream.on("close", () => {
                  fs.unlinkSync(videoPath);
                  fs.unlinkSync(audioPath);
                  // fs.unlinkSync(outputPath); // Optional: only if you don't need to cache it
                });

            })
            .on("error", (err) => {
              console.error("FFmpeg error:", err);
              res.status(500).json({ error: "Failed to merge video and audio" });
            });
        });
    });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
