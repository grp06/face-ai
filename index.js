let MediaSplit = require('media-split');
const fs = require('fs')
const _ = require('lodash');
let videoStitch = require('video-stitch');
let videoCut = videoStitch.cut;
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const ffmpeg = require('fluent-ffmpeg')
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath)

const millisToMinutesAndSeconds = (millis) => {
  var minutes = Math.floor(millis / 60000);
  var seconds = ((millis % 60000) / 1000).toFixed(0);
  return (seconds == 60 ? (minutes+1) + ":00" : minutes + ":" + (seconds < 10 ? "0" : "") + seconds);
}

const loadVideoAndGenerateClips = (videoPath, rekognitionPath, transcriptPath) => {
  const data = require(rekognitionPath)
  const personOnTheLeft = data.filter((face) => {
    return face.BoundingBox.Left < .4
  })
  
  const personOnTheRight = data.filter((face) => {
    return face.BoundingBox.Left > .6
  })

  let speakerStartTimes
  
  const getSpeakerStartTimes = (fileName) => {
    const speakerStartObjs = []
    fs.readFile(fileName, 'utf8', function(err,data){
      
      const dataAsJSON = JSON.parse(data)
      const { segments } = dataAsJSON.results.speaker_labels
      segments.forEach((item, idx) => {
        if (item.speaker_label !== speakerStartObjs[speakerStartObjs.length - 1]?.speakerLabel) {
          speakerStartObjs.push({
            speakerLabel: item.speaker_label,
            startTime: Math.round(Number(item.start_time)*1000)
          })
        }
      })
      speakerStartTimes =  speakerStartObjs.map(item => item.startTime)
      return speakerStartTimes
    })
  }
  getSpeakerStartTimes(transcriptPath)
  
  const onlyNecessaryData = (person) => {
    return person.map(obj => {
      return {
        emotion: obj.Emotions[0].Type,
        timestamp: obj.Timestamp,
        smile: obj.Smile.Value
      }
    })
  }
  
  const person1Filtered = onlyNecessaryData(personOnTheRight)
  
  const getAnyMajorEmotionChanges = (rekognitionData, emotion1, emotion2) => {
    const timestampsThatMetThreshold = []
    let counter1 = 0
    let counter2 = 0
    
    rekognitionData.forEach((item, index) => {
      const currentEmotion = item.emotion
      const previousEmotion = rekognitionData[index - 1]?.emotion
      const emotionHasntChanged = currentEmotion === previousEmotion;
      const emotionChanged = currentEmotion !== previousEmotion;
      const emotion1Threshold = 5
      const emotion2Threshold = 5
      const meetsEmotion1Threshold = counter1 >= emotion1Threshold
      const meetsEmotion2Threshold = counter2 >= emotion2Threshold
    
      // current emotion needs to be calm for 5 frames in a row
      // new emotion needs to be happy
      
      let consecutiveCalmFrames = 0;
      const isEmotion1 = currentEmotion === emotion1
      const isEmotion2 = currentEmotion === emotion2
      const previousEmotionMatched = previousEmotion === emotion1

      if (counter1 === 0 && isEmotion1) {
        counter1 += 1
      } else if (isEmotion1 && previousEmotionMatched && counter2 === 0) {
        counter1 += 1
      } else if (isEmotion2 && previousEmotionMatched && counter2 === 0) {
        counter2 += 1
      } else if (isEmotion2 && previousEmotion === emotion2 && counter2 !== 0) {
        counter2 += 1
        if (meetsEmotion1Threshold && meetsEmotion2Threshold) {
          timestampsThatMetThreshold.push((rekognitionData[index - emotion2Threshold].timestamp))
        }
      } else if (emotionChanged && counter2 > 0) {
        counter1 = 0
        counter2 = 0
      } 

      // // start counting, going to look out for the same emotion in consecutive frames
      // if (counter1 === 0) {
      //   counter1 += 1
      //   // if this frame is the same as the last frame (and we haven't detected a recent change in emotion)
      // } else if (emotionHasntChanged && counter2 === 0) {
      //   counter1 += 1
      //   // the emotion has changed. Start counting up on the newly changed emotion
      // } else if (emotionChanged && counter2 === 0) {
      //   counter2 += 1
      //   // continue counting on the newly changed emotion
      // } else if (emotionHasntChanged && counter2 > 0) {
      //   counter2 += 1
      //   // we've had 10 of one emotion and changed to 10 of a new emotion. Count this
      //   if (meetsEmotion1Threshold && meetsEmotion2Threshold) {
      //     timestampsThatMetThreshold.push((rekognitionData[index - emotion2Threshold].timestamp))
      //   }
      //   // we were counting on the new emotion but it just changed back. RESET
      // } else if (emotionChanged && counter2 > 0) {
      //   counter1 = 0
      //   counter2 = 0
      // }
    })
    const removeIfInSameRange = (timestampArray) => {
      let currentStartStamp;
      for (let i = 0; i < timestampArray.length; i++) {
        for (let j = 1; j < timestampArray.length - i; j++) {
          if (timestampArray[j + i] - timestampArray[i] < 600 * j ) {
            timestampArray[j + i] = null
          }
        }   
      }
    }
    
    removeIfInSameRange(timestampsThatMetThreshold)
    
    return timestampsThatMetThreshold.filter(stamp => stamp !== null).map(item => {
      return item
    })
  }
  
  const majorEmotionalChanges = getAnyMajorEmotionChanges(person1Filtered, 'CALM', 'HAPPY')
  
  const getClipStartTimes = () => {
    const clipStartTimes = []
    const legibleClipStartTimes = []
    majorEmotionalChanges.forEach((change, idx) => {
      const indexOfRelevantTimestamp = speakerStartTimes.findIndex(item => item > change)
      const diff = speakerStartTimes[indexOfRelevantTimestamp]/1000 - speakerStartTimes[indexOfRelevantTimestamp - 1]/1000
      if (clipStartTimes.length && clipStartTimes[clipStartTimes.length - 1][0] === speakerStartTimes[indexOfRelevantTimestamp-1]/1000) {
        console.log('skip');
      } else {
        clipStartTimes.push([speakerStartTimes[indexOfRelevantTimestamp-1]/1000,speakerStartTimes[indexOfRelevantTimestamp]/1000])
        legibleClipStartTimes.push([millisToMinutesAndSeconds(speakerStartTimes[indexOfRelevantTimestamp-1]),millisToMinutesAndSeconds(speakerStartTimes[indexOfRelevantTimestamp])])
        // if (diff < 45) {
          
          // }
        }
      })
      console.log("🚀 ~ getClipStartTimes ~ legibleClipStartTimes", legibleClipStartTimes)
    return clipStartTimes
  }
  
  setTimeout(() => {
    const clipStartTimes = getClipStartTimes()
  
    const generateAllClips = () => {
      fs.mkdir(path.join(__dirname, `clips/${videoPath.split('.')[0]}`), (err) => {
        if (err) {
            console.error(err);
        }
        clipStartTimes.forEach((range, idx) => {
          try {
            ffmpeg(videoPath)
            .setStartTime(clipStartTimes[idx][0])
            .setDuration(clipStartTimes[idx][1] - clipStartTimes[idx][0])
            .output(`../face-ai-videos/clips/${videoPath.split('.')[0]}/clip-${idx + 1}.mp4`)
            .on('end', function(err) {
              if (!err) { 
                console.log(`video ${idx + 1} of ${clipStartTimes.length} clipped`) 
              }
            })
            .on('error', function(err){
              console.log('error: ', err)
            }).run()
          } catch (error) {
            console.log('error = ', error);
          }
    
        })
      });
    }
    // generateAllClips()
  
  }, 500);

}

const stringRoot = 'yang-full'

// videoPath, rekognitionPath, transcriptPath
loadVideoAndGenerateClips(`../face-ai-videos/${stringRoot}.mp4`, `./rekognition-data/${stringRoot}.json`,`./transcriptions/${stringRoot}.json`)