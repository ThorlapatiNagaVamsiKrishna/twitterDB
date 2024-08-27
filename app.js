const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jsonwebtoken = require('jsonwebtoken')
const {format} = require('date-fns')
const twitterDatabasePath = path.join(__dirname, 'twitterClone.db')
let twitterDatabase = null
app = express()
app.use(express.json())

const intializeAndConnectServer = async () => {
  try {
    twitterDatabase = await open({
      filename: twitterDatabasePath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('Server is Running at http://localhost:3000')
    })
  } catch (e) {
    console.log(`DB Error:'${e.message}'`)
  }
}

intializeAndConnectServer()

const authenticationToken = (request, response, next) => {
  let authenticateToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    authenticateToken = authHeader.split(' ')[1]
  }
  if (authenticateToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jsonwebtoken.verify(
      authenticateToken,
      'MY_SECRETE_KEY',
      async (error, payload) => {
        if (error) {
          response.status(401)
          response.send('Invalid JWT Token')
        } else {
          request.username = payload.username
          request.userId = payload.userId
          next()
        }
      },
    )
  }
}

// second Middleware function
const followingStatusCheck = async (request, response, next) => {
  const {userId} = request
  const getFollowingListQwery = `
    SELECT following_user_id FROM 
    user INNER JOIN follower 
    ON user.user_id = follower.follower_user_id 
    WHERE user.user_id = ${userId}`
  const resultFollowingList = await twitterDatabase.all(getFollowingListQwery)
  let following_id = []
  for (let eachFollower of resultFollowingList) {
    following_id.push(eachFollower.following_user_id)
  }
  request.following_id = following_id
  next()
}

app.post('/register/', async (request, response) => {
  const {name, username, password, gender} = request.body
  const getExistsUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const resultUser = await twitterDatabase.get(getExistsUserQuery)
  // If the username already exists
  if (resultUser !== undefined) {
    response.status(400)
    response.send('User already exists')
  }
  // If the registrant provides a password with less than 6 characters
  else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    }
    // Successful registration of the registrant
    else {
      const encryptedPassword = await bcrypt.hash(password, 10)
      const registerNewUserQuery = `
            INSERT INTO user(name,username, password, gender)
            VALUES('${name}', '${username}', '${encryptedPassword}', '${gender}');`
      const resultNewUser = await twitterDatabase.run(registerNewUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`

  const resultUser = await twitterDatabase.get(getUserQuery)
  // If the user doesn't have a Twitter account
  if (resultUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    // Successful login of the user
    const {user_id} = resultUser
    const isOriginalPassword = await bcrypt.compare(
      password,
      resultUser.password,
    )
    if (isOriginalPassword === true) {
      const payload = {username: username, userId: user_id}
      const jwtToken = jsonwebtoken.sign(payload, 'MY_SECRETE_KEY')
      response.send({jwtToken})
    }
    // If the user provides an incorrect password
    else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

// returns the latest tweets of people whom the user follows.
app.get(
  '/user/tweets/feed/',
  authenticationToken,
  followingStatusCheck,
  async (request, response) => {
    const {following_id} = request
    const getFollowingUsersQuery = `
    SELECT username, tweet, date_time as dateTime
    FROM user INNER JOIN  tweet  ON user.user_id = tweet.user_id
    WHERE tweet.user_id IN (${[...following_id]})
    order by tweet.date_time DESC
    LIMIT 4`
    const resultFollowingUserTweets = await twitterDatabase.all(
      getFollowingUsersQuery,
    )
    response.send(resultFollowingUserTweets)
  },
)
// Returns the list of all names of people whom the user follows
app.get(
  '/user/following/',
  authenticationToken,
  followingStatusCheck,
  async (request, response) => {
    const {following_id} = request
    const getFollowingUsersQuery = `SELECT name
    FROM user WHERE user_id IN (${[...following_id]})`
    const resultFollowingUserNames = await twitterDatabase.all(
      getFollowingUsersQuery,
    )
    response.send(resultFollowingUserNames)
  },
)
// Returns the list of all names of people who follows the user
app.get('/user/followers/', authenticationToken, async (request, response) => {
  const {userId} = request
  const getFollowingListQwery = `
  SELECT follower_user_id FROM ( user INNER JOIN follower 
  ON user.user_id = follower.following_user_id ) 
  WHERE user.user_id = ${userId};`
  const resultFollowingList = await twitterDatabase.all(getFollowingListQwery)
  let following_id = []
  for (let eachFollower of resultFollowingList) {
    following_id.push(eachFollower.follower_user_id)
  }
  const getFollowingUsersQuery = `SELECT name
    FROM user WHERE user_id IN (${[...following_id]})`
  const resultFollowingUserNames = await twitterDatabase.all(
    getFollowingUsersQuery,
  )
  response.send(resultFollowingUserNames)
})

// If the user requests a tweet other than the users he is following
app.get(
  '/tweets/:tweetId/',
  authenticationToken,
  followingStatusCheck,
  async (request, response) => {
    const {tweetId} = request.params
    // If the user requests a tweet other than the users he is following
    const {following_id} = request
    const getTweetQuery = `
  SELECT 
  tweet,
  date_time AS dateTime
  FROM
  tweet
  WHERE tweet.user_id IN (${[...following_id]}) AND tweet.tweet_id = ${tweetId}`
    let tweetData = await twitterDatabase.get(getTweetQuery)
    if (tweetData !== undefined) {
      const getLikesQuery = `SELECT count(*) as likes 
    FROM like WHERE tweet_id = ${tweetId}`
      const likesData = await twitterDatabase.get(getLikesQuery)
      tweetData.likes = likesData.likes

      const getReplyQuery = `SELECT count(*) as replies
    FROM like WHERE tweet_id = ${tweetId}`
      const replyData = await twitterDatabase.get(getReplyQuery)
      tweetData.replies = replyData.replies

      const responseTweet = {
        tweet: tweetData.tweet,
        likes: tweetData.likes,
        replies: tweetData.replies,
        dateTime: tweetData.dateTime,
      }
      response.send(responseTweet)
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  authenticationToken,
  followingStatusCheck,
  async (request, response) => {
    const {tweetId} = request.params
    const {following_id} = request

    const getLikedUserQuery = `SELECT username FROM ( tweet INNER JOIN like ON
      tweet.tweet_id = like.tweet_id ) AS T
      INNER JOIN user ON like.user_id = user.user_id
      WHERE tweet.tweet_id = ${tweetId} AND tweet.user_id IN (${[
        ...following_id,
      ]}) `
    const geLikesData = await twitterDatabase.all(getLikedUserQuery)
    if (geLikesData.length === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const likedUsers = {
        likes: [],
      }
      for (let eachUser of geLikesData) {
        likedUsers.likes.push(eachUser.username)
      }
      response.send(likedUsers)
    }
  },
)

// requests a tweet of a user he is following, return the list of replies.
app.get(
  '/tweets/:tweetId/replies/',
  authenticationToken,
  followingStatusCheck,
  async (request, response) => {
    const {tweetId} = request.params
    const {following_id} = request
    const getTweetReplyQuery = `
    SELECT name, reply FROM tweet INNER JOIN user ON
    tweet.user_id = user.user_id 
    INNER JOIN  reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.tweet_id = ${tweetId}`
    const tweetReplyData = await twitterDatabase.all(getTweetReplyQuery)
    if (tweetReplyData.length === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const replyedUsers = {
        replies: tweetReplyData,
      }

      response.send(replyedUsers)
    }
  },
)

// Returns a list of all tweets of the user

app.get('/user/tweets/', authenticationToken, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const getTweetInfoQuery = `SELECT tweet, count(*) AS likes, date_time AS dateTime FROM
  ( user INNER JOIN  tweet ON user.user_id = tweet.user_id ) AS T
  INNER JOIN like ON tweet.tweet_id = like.tweet_id 
  WHERE user.user_id = ${userId}
  GROUP BY tweet.tweet_id`
  const tweetInfo = await twitterDatabase.all(getTweetInfoQuery)
  const replyTweetInfo = `SELECT count(*) as replies FROM ( user INNER JOIN tweet
  ON user.user_id = tweet.user_id ) AS T INNER JOIN reply
  ON tweet.tweet_id = reply.tweet_id
  WHERE user.user_id = ${userId}
  GROUP BY tweet.tweet_id`
  const replyInfo = await twitterDatabase.all(replyTweetInfo)
  let finalResult = [...tweetInfo]
  for (let i = 0; i < replyInfo.length; i++) {
    finalResult.map(eachValue => (eachValue.replies = replyInfo[i].replies))
  }
  let finalResponse = finalResult.map(eachItem => ({
    tweet: eachItem.tweet,
    likes: eachItem.likes,
    replies: eachItem.replies,
    dateTime: eachItem.dateTime,
  }))
  response.send(finalResponse)
})

// Create a tweet in the tweet table
app.post('/user/tweets/', authenticationToken, async (request, response) => {
  const {userId} = request
  const {tweet} = request.body
  const date = new Date()
  const resultDate = format(date, 'yyyy-MM-dd HH:mm:ss')
  const createTweetQuery = `
  INSERT INTO tweet ( tweet, user_id, date_time)
  VALUES ('${tweet}', ${userId}, '${resultDate}')`
  const dbResponse = await twitterDatabase.run(createTweetQuery)
  response.send('Created a Tweet')
})

module.exports = app
