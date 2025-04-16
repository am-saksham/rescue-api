const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Cloudinary Configuration (You can use other storage options like AWS S3)
cloudinary.config({
  cloud_name: 'dbxdejufj',
  api_key: '512749837966285',
  api_secret: 'U4hJhTUtnaj-gr5WasOgrP0D4XY',
});

// Connect to MongoDB
mongoose.connect('mongodb+srv://amsakshamgupta:admin1234@cluster0.z20foql.mongodb.net/emergency_app?retryWrites=true&w=majority&appName=Cluster0', {
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
  image: String, // The image field will store the image URL
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
const Volunteer = mongoose.model('Volunteer', VolunteerSchema, 'volunteers');

// Set up multer for handling image uploads
const storage = multer.memoryStorage(); // Store images in memory
const upload = multer({ storage: storage });

// Route to save volunteer with image
app.post('/api/volunteers', upload.single('image'), async (req, res) => {
  try {
    const { name, contact, message } = req.body;
    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress; // Get the IP address from request

    // Check if contact already exists
    const existing = await Volunteer.findOne({ contact });
    if (existing) {
      return res.status(400).json({ success: false, message: "Contact already exists." });
    }

    let imageUrl = ''; // Default value

    // If an image is provided, upload it to Cloudinary
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
      image: imageUrl, // Save the image URL
    });

    await newVolunteer.save();
    res.status(201).json({ success: true, message: "Volunteer saved!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route to get volunteer by contact
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

// Route to update volunteer location
app.put('/api/volunteers/location', async (req, res) => {
  try {
    const { contact, latitude, longitude } = req.body;
    const timestamp = new Date();

    const volunteer = await Volunteer.findOne({ contact });
    if (!volunteer) {
      return res.status(404).json({ success: false, message: 'Volunteer not found' });
    }

    // Push the new location to the beginning of the array
    volunteer.locations.unshift({ latitude, longitude, timestamp });

    // Keep only the latest 5 locations
    if (volunteer.locations.length > 5) {
      volunteer.locations = volunteer.locations.slice(0, 5);
    }

    await volunteer.save();

    res.json({ success: true, message: 'Location updated', locations: volunteer.locations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));