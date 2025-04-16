const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');

const app = express();

// Hardcoded configuration
const CLOUDINARY_CLOUD_NAME = 'dbxdejufj';
const CLOUDINARY_API_KEY = '512749837966285';
const CLOUDINARY_API_SECRET = 'U4hJhTUtnaj-gr5WasOgrP0D4XY';
const MONGODB_URI = 'mongodb+srv://amsakshamgupta:admin1234@cluster0.z20foql.mongodb.net/emergency_app?retryWrites=true&w=majority&appName=Cluster0';
const PORT = 5000; // or any other port you want to use

// Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

// Cloudinary Configuration
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET
});

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// Volunteer Schema
const VolunteerSchema = new mongoose.Schema({
  name: String,
  contact: {
    type: String,
    unique: true,
    required: true
  },
  message: String,
  ip_address: String,
  image: String,
  locations: [
    {
      latitude: Number,
      longitude: Number,
      timestamp: {
        type: Date,
        default: Date.now
      }
    }
  ]
});
VolunteerSchema.index({ contact: 1 });
VolunteerSchema.index({ 'locations.timestamp': -1 });
const Volunteer = mongoose.model('Volunteer', VolunteerSchema, 'volunteers');

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Rate limiting
const locationUpdateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many location updates from this IP, please try again later'
});

// Routes
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

app.post('/api/volunteers/:volunteerId/photo', upload.single('image'), async (req, res) => {
  try {
    const volunteerId = req.params.volunteerId;
    const volunteer = await Volunteer.findById(volunteerId);
    
    if (!volunteer) {
      return res.status(404).json({ success: false, message: 'Volunteer not found' });
    }

    let imageUrl = '';

    if (req.file) {
      imageUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'image' },
          (error, result) => {
            if (error) return reject(error);
            resolve(result.secure_url);
          }
        );
        stream.end(req.file.buffer);
      });
    }

    volunteer.image = imageUrl;
    await volunteer.save();

    res.status(200).json({ success: true, message: 'Image uploaded successfully', imageUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/volunteers', upload.single('image'), async (req, res) => {
  try {
    const { name, contact, message } = req.body;
    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const existing = await Volunteer.findOne({ contact });
    if (existing) {
      return res.status(400).json({ success: false, message: "Contact already exists." });
    }

    let imageUrl = '';

    if (req.file) {
      imageUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'image' },
          (error, result) => {
            if (error) return reject(error);
            resolve(result.secure_url);
          }
        );
        stream.end(req.file.buffer);
      });
    }

    const newVolunteer = new Volunteer({
      name,
      contact,
      message,
      ip_address,
      image: imageUrl,
    });

    await newVolunteer.save();
    res.status(201).json({ 
      success: true, 
      message: "Volunteer saved!", 
      _id: newVolunteer._id 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/volunteers/:contact', async (req, res) => {
  try {
    const contact = req.params.contact;
    const existing = await Volunteer.findOne({ contact });

    if (existing) {
      res.status(200).json({ exists: true });
    } else {
      res.status(404).json({ exists: false });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/volunteers/location', 
  locationUpdateLimiter,
  [
    body('contact').notEmpty().isString(),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { contact, latitude, longitude } = req.body;
      
      const result = await Volunteer.findOneAndUpdate(
        { contact },
        {
          $push: {
            locations: {
              $each: [{ latitude, longitude, timestamp: new Date() }],
              $slice: 5,
              $sort: { timestamp: -1 }
            }
          }
        },
        { new: true }
      );

      if (!result) {
        return res.status(404).json({ success: false, message: 'Volunteer not found' });
      }

      res.json({ 
        success: true, 
        message: 'Location updated', 
        locations: result.locations 
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    error: 'Something went wrong!',
    message: 'development' === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));