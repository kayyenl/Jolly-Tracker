const asyncHandler = require('express-async-handler')
//after adding asyncHandler, we dont need to put a try catch block inside our code.
const User = require('../models/userModel')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const Token = require('../models/tokenModel')
const crypto = require("crypto")
const sendEmail = require('../utils/sendEmail')

const generateToken = (id) => {
    //parameters of jwt.sign: 
    //1. an object aka. what attirbutes do u wanna create the token with? id here
    //2. slow in our jwt secret, stored in our env
    //3. how long do u want this token to last?
    return jwt.sign({ id }, process.env.JWT_SECRET, {expiresIn: "1d"})
}

//functions interacting with databases should be async.
//Register User
const registerUser = asyncHandler(async (req, res) => {
    const { name, email, password } = req.body

    //validation of user particulars in backend
    if (!name || !email || !password) {
        res.status(400)
        throw new Error("Please fill in all the required fields.")
    }

    if (password.length < 6) {
        res.status(400)
        throw new Error("Password must be at least 6 characters.")
    }

    //check if user's email already exists
    //anytime we wish to talk to database, we use model
    const userEmailExists = await User.findOne({email})

    if (userEmailExists) {
        res.status(400)
        throw new Error("This email has already been registered")
    }

    
    //Create new user
    const user = await User.create({ //so User.create returns a mongodb object with new attributes.
        name,
        email,
        password,
    })


    //Generate token 
    const token = generateToken(user._id)

    //Send HTTP-only cookie 
    //A cookie is a piece of data from a website that is stored within a web browser that the website can retrieve at a later time.
    res.cookie("token", token, {
        path: "/",
        httpOnly: true,
        expires: new Date(Date.now() + 1000 * 86400), //1 day
        sameSite: 'none', //altho we use vercel for frontend and render for backend, i still want this to work.
        secure: true, //in a local environment, it is only executed when deployed.
    }) //argument is what u want the cookie to be saved as in the frontend

    if (user) { //here we are getting the details of user back from db.
        //we are getting data back from mongoDB in json format
        //status code 201 means new user created
        const { _id, name, email, photo, phone, bio } = user
        res.status(201).json({
            _id, name, email, photo, phone, bio, token
        }) 
    } else {
        res.status(400)
        throw new Error("Invalid user data")
    }
})

//Login User
const loginUser = asyncHandler(async (req, res) => {

    const { email, password } = req.body

    //We want to validate the request
    if (!email || !password) {
        res.status(400)
        throw new Error("Please add your email and password")
    }

    //Check if user exists
    const user = await User.findOne({ email })
    if (!user) {
        res.status(400)
        throw new Error("User not found! Please sign up if you have no account.")
    }

    //If user exists, check if the password is the same'
    //we stored the password after getting hashed by bcrypt
    //using bcrypt, we can also check if the raw password is same as hashed
    const passwordIsCorrect = await bcrypt.compare(password, user.password)

    const token = generateToken(user._id)
    //THIS TOKEN CHANGES EVERY GENERATE!!! MUST KNOW

    res.cookie("token", token, {
        path: "/",
        httpOnly: true,
        expires: new Date(Date.now() + 1000 * 86400), //1 day
        sameSite: 'none', //altho we use vercel for frontend and render for backend, i still want this to work.
        secure: true, //in a local environment, it is only executed when deployed.
    })

    if (user && passwordIsCorrect) {
        const { _id, name, email, photo, phone, bio } = user
        res.status(200).json({   //status code 200 denotes a successful response.
            _id, name, email, photo, phone, bio, token
        }) 
    } else {
        res.status(400)
        throw new Error("Invalid email or password entered.")
    }

    //now, we have to generate the token and send the cookie to frontend
})

const logout = asyncHandler(async (req, res) => {
    //to logout, we can either DELETE, or EXPIRE the cookie.

    res.cookie("token", "", { //second argument is empty string as we are not saving anything this time.
        path: "/",
        httpOnly: true,
        expires: new Date(0), //immediately expires the cookie.
        sameSite: 'none', //altho we use vercel for frontend and render for backend, i still want this to work.
        secure: true, //in a local environment, it is only executed when deployed.
    })

    res.status(200).json({ message: "Successfully logged out."})
})

//Get users data / profile
const getUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)
    //any time u talk to the db, u gotta do an await

    if (user) {
        const { _id, name, email, photo, phone, bio } = user
        res.status(200).json({   //status code 200 denotes a successful response.
            _id, name, email, photo, phone, bio
        }) 
    } else {
        throw new Error("User is not found.")
    }
})


//get login status, to check if someone is logged in or not
const loginStatus = asyncHandler(async (req, res) => {
    const token = req.cookies.token
    if (!token) {
        return res.json(false) 
    }

    const verified = jwt.verify(token, process.env.JWT_SECRET)
    if (verified) {
        return res.json(true)
    }

    return res.json(false)
})

//Update user
//we can access the user's id since we passed in the protect middleware in this call too.   
const updateUser = asyncHandler(async(req, res) => {
    const user = await User.findById(req.user._id)

    if (user) {
        const { name, email, photo, phone, bio } = user
        user.email = email
        user.name = req.body.name || name
        user.photo = req.body.photo || photo
        user.phone = req.body.phone || phone
        user.bio = req.body.bio || bio

        const updatedUser = await user.save()
        res.status(200).json({   //status code 200 denotes a successful response.
            _id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            photo: updatedUser.photo,
            phone: updatedUser.phone, 
            bio: updatedUser.bio,
        }) //we will deal with the password separately 
    } else {
        res.status(404)
        throw new Error("User not found.")
    } 
})

const changePassword = asyncHandler(async(req, res) => {
    const user = await User.findById(req.user._id) //protect gives us access to the user thru this line.
    const { oldPassword, password } = req.body //req.body is like what we submit via the frontend.

    if (!user) { //check if user is logged in or not
        res.status(400)
        throw new Error("User not found, please signup.")
    }

    //Validating the form is filled up
    if (!oldPassword || !password) {
        res.status(400)
        throw new Error("Please enter your old and new passwords.")
    }

    //check if password entered matches password in db
    const passwordIsCorrect = await bcrypt.compare(oldPassword, user.password)

    //we will now save the new password
    if (user && passwordIsCorrect) {
        user.password = password
        await user.save()
        res.status(200).send("Password changed successfully.")
    } else {
        res.status(400)
        throw new Error("The old password is incorrect.")
    }

}) 

const forgotPassword = asyncHandler( async (req, res) => {
    const { email } = req.body
    const user = await User.findOne({ email })

    if (!user) {
        res.status(404)
        throw new Error("This user does not exist.")
    }

    //Delete token if it exists in the db
    //and create a fresh token
    let token = await Token.findOne({
        userId: user._id,
    })

    if (token) {
        await Token.deleteOne(token)
    }

    //Create the reset password token
    //crypto is a nodejs native module, 32 chars in this argument
    //btw, this token changes every time
    let resetToken = crypto.randomBytes(32).toString("hex") + user._id
    console.log(resetToken)


    //we are going to hash the token before saving to db
    const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex")

    //Now we save this generated token into the db
    //there are a few ways to save into database
    //1. Model.create()
    //2. assign to variable and call .save()
    await new Token({
        userId: user._id,
        token: hashedToken,
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * (60*1000) //thirty minutes
    }).save()

    // Construct Reset Url user will use
    const resetUrl = `${process.env.FRONTEND_URL}/resetpassword/${resetToken}`

    //Reset Email fields
    const message = 
    `
        <h2>Hello ${user.name} </h2>
        <p>Please use the url below to reset your password.</p>
        <p>This reset link is only valid for 30 minutes.</p>
        <p>If you did not request for this, please ignore this email.</p>
        
        <a href=${resetUrl} clicktracking=off>
        ${resetUrl}
        </a>
        
        <p> Regards... </p>
        <p> The Jolly Team </p>
    `

    const subject = "Password Reset Request"
    const send_to = user.email
    const sent_from = process.env.EMAIL_USER

    try {
        await sendEmail(subject, message, send_to, sent_from)
        res.status(200).json({
            success: true,
            message: "Reset Email is sent"
        })
    } catch (error) {
        res.status(500)
        throw new Error("Email is not sent, please try again.")
    }

    //Still, an error may be thrown if ur ip address gets blacklisted, and other 
    //unexpected reasons.
}) 

//Steps when forget password
//1. create forgot password route
//2. create token model
//3. create email sender
//4. create controller function

const resetPassword = asyncHandler(async (req, res) => {
    
    const { password } = req.body
    const { resetToken } = req.params

    //We will then hash this token, and compare it to the database
    const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex")

    //find token in db
    const userToken = await Token.findOne({ //this object in the findOne argument is checking if there are any matches in Token db.
        token: hashedToken,
        expiresAt: { $gt: Date.now() } //this is mongoose lingo to check if expired.
    })

    if (!userToken) {
        res.status(404)
        throw new Error("Your token is invalid, please make another request.")
    }

    //Find the user
    const user = await User.findOne({
        _id: userToken.userId
    })
    user.password = password
    await user.save()
    res.status(200).json({ //we do these json things to send stuff back to the frontend.
        message: "Password reset successful! Please log in."
    })

})

module.exports = {
    registerUser,
    loginUser,
    logout,
    getUser,
    loginStatus,
    updateUser,
    changePassword,
    forgotPassword,
    resetPassword,
}
