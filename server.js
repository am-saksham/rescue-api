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
.then(() => {
  console.log("MongoDB Connected Successfully");
  // Ensure indexes after connection
  return mongoose.connection.db.collection('volunteers').createIndex({ location: "2dsphere" });
})
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
    set: email => email.toLowerCase()
  },
  message: { type: String, required: true },
  ip_address: String,
  image: String,
  device_token: String, // For push notifications
  location: {
    type: {
      type: String,
      default: 'Point',
      enum: ['Point']
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  }
}, { 
  timestamps: true,
  autoIndex: true 
});

// Create indexes
VolunteerSchema.index({ location: '2dsphere' });
VolunteerSchema.index({ email: 1 });

const Volunteer = mongoose.model('Volunteer', VolunteerSchema);

// Emergency Request Schema
const EmergencyRequestSchema = new mongoose.Schema({
  requester_ip: String,
  location: {
    type: {
      type: String,
      default: 'Point',
      enum: ['Point']
    },
    coordinates: [Number]
  },
  radius: Number,
  volunteers_notified: [{
    volunteer_id: mongoose.Schema.Types.ObjectId,
    response: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    responded_at: Date
  }],
  status: { type: String, enum: ['active', 'completed'], default: 'active' }
}, { timestamps: true });

EmergencyRequestSchema.index({ location: '2dsphere' });
const EmergencyRequest = mongoose.model('EmergencyRequest', EmergencyRequestSchema);

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

const locationUpdateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

// Helper function to send notifications (mock implementation)
async function sendPushNotification(deviceToken, message) {
  console.log(`Sending notification to ${deviceToken}: ${message}`);
  // In production, integrate with FCM/APNs/OneSignal here
  return true;
}

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
  res.send('Emergency Response API 🚨');
});

// Volunteer Endpoints
app.post('/api/volunteers', upload.single('image'), [
  body('name').trim().notEmpty(),
  body('email').trim().isEmail(),
  body('message').trim().notEmpty(),
  body('device_token').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { name, email, message, device_token } = req.body;
    const ip_address = req.headers['x-forwarded-for'] || req.ip;

    const existing = await Volunteer.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    let imageUrl = '';
    if (req.file) {
      imageUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'image' },
          (error, result) => error ? reject(error) : resolve(result.secure_url)
        );
        stream.end(req.file.buffer);
      });
    }

    const newVolunteer = new Volunteer({
      name,
      email,
      message,
      ip_address,
      image: imageUrl,
      device_token,
      location: { type: 'Point', coordinates: [0, 0] } // Default location
    });

    await newVolunteer.save();
    
    res.status(201).json({ 
      success: true, 
      message: "Volunteer registered successfully", 
      data: {
        _id: newVolunteer._id,
        name: newVolunteer.name,
        email: newVolunteer.email
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/volunteers/location', locationUpdateLimiter, [
  body('email').isEmail(),
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, latitude, longitude } = req.body;
    
    const result = await Volunteer.findOneAndUpdate(
      { email },
      {
        $set: {
          location: {
            type: 'Point',
            coordinates: [longitude, latitude]
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
      location: result.location
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Emergency Endpoints
app.post('/api/emergency/request-help', [
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
  body('radius').isInt({ min: 1, max: 50 })
], async (req, res) => {
  try {
    const { latitude, longitude, radius } = req.body;
    const ip_address = req.headers['x-forwarded-for'] || req.ip;

    // Create emergency request record
    const emergencyRequest = new EmergencyRequest({
      requester_ip: ip_address,
      location: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      radius,
      status: 'active'
    });

    // Find nearby volunteers (excluding requester)
    const volunteers = await Volunteer.find({
      location: {
        $nearSphere: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude]
          },
          $maxDistance: radius * 1000
        }
      },
      ip_address: { $ne: ip_address },
      device_token: { $exists: true, $ne: null }
    }).limit(20);

    if (volunteers.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No available volunteers in your area'
      });
    }

    // Record notified volunteers
    emergencyRequest.volunteers_notified = volunteers.map(v => ({
      volunteer_id: v._id
    }));

    await emergencyRequest.save();

    // Send notifications
    const notificationResults = await Promise.all(
      volunteers.map(async volunteer => {
        try {
          const sent = await sendPushNotification(
            volunteer.device_token,
            `Emergency alert! Someone needs help within ${radius}km of your location.`
          );
          return { volunteer_id: volunteer._id, success: sent };
        } catch (err) {
          console.error(`Notification failed for ${volunteer.email}:`, err);
          return { volunteer_id: volunteer._id, success: false };
        }
      })
    );

    res.status(200).json({ 
      success: true,
      message: 'Help request initiated',
      request_id: emergencyRequest._id,
      volunteers_notified: volunteers.length,
      notification_results: notificationResults
    });
  } catch (err) {
    console.error('Emergency request error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/emergency/respond', [
  body('request_id').isMongoId(),
  body('volunteer_id').isMongoId(),
  body('accept').isBoolean()
], async (req, res) => {
  try {
    const { request_id, volunteer_id, accept } = req.body;
    
    // Update emergency request with response
    const update = await EmergencyRequest.findOneAndUpdate(
      {
        _id: request_id,
        'volunteers_notified.volunteer_id': volunteer_id,
        'volunteers_notified.response': 'pending'
      },
      {
        $set: {
          'volunteers_notified.$.response': accept ? 'accepted' : 'rejected',
          'volunteers_notified.$.responded_at': new Date(),
          status: accept ? 'completed' : 'active'
        }
      },
      { new: true }
    );

    if (!update) {
      return res.status(404).json({ 
        success: false,
        message: 'Request not found or already responded'
      });
    }

    // Get volunteer details if accepted
    let volunteerData = null;
    if (accept) {
      const volunteer = await Volunteer.findById(volunteer_id);
      if (volunteer) {
        volunteerData = {
          _id: volunteer._id,
          name: volunteer.name,
          image: volunteer.image
        };
      }
    }

    res.status(200).json({ 
      success: true,
      message: accept ? 'Thank you for helping!' : 'Response recorded',
      volunteer: volunteerData,
      request_status: update.status
    });
  } catch (err) {
    console.error('Response error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});