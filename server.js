const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

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

// Route to save volunteer
app.post('/api/volunteers', async (req, res) => {
  try {
    const { name, contact, message } = req.body;
    const existing = await Volunteer.findOne({ contact });
    if (existing) {
      return res.status(400).json({ success: false, message: "Contact already exists." });
    }
    const newVolunteer = new Volunteer({ name, contact, message });
    await newVolunteer.save();
    res.status(201).json({ success: true, message: "Volunteer saved!" });
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