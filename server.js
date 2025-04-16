const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');

const app = express();

// Trust proxy in production environment
app.set('trust proxy', true);

// Configuration
const CLOUDINARY_CONFIG = {
  cloud_name: 'dbxdejufj',
  api_key: '512749837966285',
  api_secret: 'U4hJhTUtnaj-gr5WasOgrP0D4XY'
};

const MONGODB_URI = 'mongodb+srv://amsakshamgupta:admin1234@cluster0.z20foql.mongodb.net/emergency_app?retryWrites=true&w=majority&appName=Cluster0';
const PORT = 5000;

// Middleware
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Cloudinary Configuration
cloudinary.config(CLOUDINARY_CONFIG);

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  retryWrites: true,
  w: 'majority'
})
.then(() => console.log("MongoDB Connected Successfully"))
.catch(err => console.error("MongoDB Connection Error:", err));

// Volunteer Schema
const VolunteerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    index: true,
    validate: {
      validator: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      message: props => `${props.value} is not a valid email!`
    },
    set: email => email.toLowerCase() // Only lowercase, preserve dots
  },
  message: { type: String, required: true },
  ip_address: String,
  image: String,
  locations: [{
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
  }]
}, { 
  timestamps: true,
  autoIndex: true 
});

VolunteerSchema.index({ email: 1 });
VolunteerSchema.index({ 'locations.timestamp': -1 });

const Volunteer = mongoose.model('Volunteer', VolunteerSchema);

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Rate limiting with proxy support
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

const locationUpdateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

// Routes
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

app.get('/', (req, res) => {
  res.send('API is up and running 🚀');
});

// Get volunteer by ID endpoint
app.get('/api/volunteers/:id', async (req, res) => {
  try {
    const volunteer = await Volunteer.findById(req.params.id);
    
    if (!volunteer) {
      return res.status(404).json({ 
        success: false,
        message: 'Volunteer not found' 
      });
    }

    res.status(200).json({
      success: true,
      data: {
        _id: volunteer._id,
        email: volunteer.email,
        name: volunteer.name,
        image: volunteer.image
      }
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
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

    res.status(200).json({ 
      success: true, 
      message: 'Image uploaded successfully', 
      imageUrl,
      email: volunteer.email // Include email in response
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

app.post('/api/volunteers', upload.single('image'), [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Valid email is required'), // Removed normalizeEmail()
  body('message').trim().notEmpty().withMessage('Message is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { name, email, message } = req.body;
    const ip_address = req.headers['x-forwarded-for'] || req.ip;

    // Check for existing volunteer
    const existing = await Volunteer.findOne({ email });
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: "Email already registered" 
      });
    }

    // Handle image upload if present
    let imageUrl = '';
    if (req.file) {
      try {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { resource_type: 'image' },
            (error, result) => {
              if (error) reject(error);
              resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });
        imageUrl = uploadResult.secure_url;
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({ 
          success: false, 
          message: 'Image upload failed' 
        });
      }
    }

    // Create new volunteer
    const newVolunteer = new Volunteer({
      name,
      email,
      message,
      ip_address,
      image: imageUrl,
    });

    await newVolunteer.save();
    
    res.status(201).json({ 
      success: true, 
      message: "Volunteer registered successfully", 
      _id: newVolunteer._id,
      name: newVolunteer.name,
      email: newVolunteer.email
    });

  } catch (err) {
    console.error('Volunteer registration error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Registration failed',
      error: err.message 
    });
  }
});

app.get('/api/volunteers/email/:email', async (req, res) => {
  try {
    const email = req.params.email;
    const existing = await Volunteer.findOne({ email });

    if (existing) {
      res.status(200).json({ 
        exists: true,
        _id: existing._id,
        email: existing.email
      });
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
    body('email').notEmpty().isString(),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { email, latitude, longitude } = req.body;
      
      const result = await Volunteer.findOneAndUpdate(
        { email },
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
        locations: result.locations,
        email: result.email
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
    error: 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: production`);
});