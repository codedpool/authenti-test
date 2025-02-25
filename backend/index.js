require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const { RekognitionClient, DetectFacesCommand } = require('@aws-sdk/client-rekognition');
const cookieParser = require('cookie-parser');

const authMiddleware = require('./middleware/authMiddleware');
const authController = require('./controllers/authController');
const testController = require('./controllers/testController');
const studentController = require('./controllers/studentController');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL;

// Configure Socket.IO with dynamic FRONTEND_URL
const io = new Server(server, { 
  cors: { 
    origin: FRONTEND_URL, 
    credentials: true 
  } 
});

// Configure CORS with dynamic FRONTEND_URL
app.use(cors({ 
  origin: FRONTEND_URL, 
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

// Multer setup for image uploads
const upload = multer({ storage: multer.memoryStorage() });

// MongoDB Connection
const connectDB = require('./config/db');
connectDB();

// AWS Rekognition Client
const rekognition = new RekognitionClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Auth Routes
app.post('/register', authController.register);
app.post('/login', authController.login);

// Get authenticated user details
app.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: { id: user._id, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Logout Route
app.post('/logout', (req, res) => {
  console.log('Logout request received');
  try {
    // Clear the token cookie with explicit attributes matching the login route
    res.cookie('token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Match login settings
      sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Strict', // Match login settings
      path: '/', // Explicitly set path to root to ensure it matches
      expires: new Date(0), // Expire immediately
    });
    console.log('Token cookie cleared');
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ message: 'Server error during logout' });
  }
});

// Test Routes
app.post('/tests', authMiddleware, testController.createTest);
app.get('/tests', authMiddleware, testController.getTests);
app.post('/tests/:id/submit', authMiddleware, testController.submitTest);
app.post('/tests/:id/assign', authMiddleware, testController.assignTest);

// Student Routes
app.get('/students', authMiddleware, studentController.getStudents);

// Face Detection Route
app.post('/detect-faces', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image uploaded' });

  try {
    const command = new DetectFacesCommand({
      Image: { Bytes: req.file.buffer },
      Attributes: ['ALL'],
    });

    const response = await rekognition.send(command);
    const faceDetails = response.FaceDetails;

    let message = 'Face detected';
    let alertType = 'success';

    if (faceDetails.length === 0) {
      message = 'No face detected!';
      alertType = 'warning';
      io.emit('alert', { type: 'warning', message });
    } else if (faceDetails.length > 1) {
      message = 'Multiple faces detected!';
      alertType = 'danger';
      io.emit('alert', { type: 'danger', message });
    } else {
      io.emit('alert', { type: 'success', message });
    }

    res.json({ faceCount: faceDetails.length, message, alertType });
  } catch (error) {
    console.error('AWS Rekognition Error:', error);
    res.status(500).json({ message: 'Error processing image' });
  }
});

// Start Server
server.listen(5000, () => console.log('Server running on port 5000'));