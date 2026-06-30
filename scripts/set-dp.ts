import 'dotenv/config';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';

async function setProfilePicture() {
  try {
    const photoPath = 'd:/Projects/K-PT-MM/Luxury finance monogram emblem.png';
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!fs.existsSync(photoPath)) {
      console.error("Error: Profile picture file not found at", photoPath);
      process.exit(1);
    }

    const form = new FormData();
    form.append('photo', fs.createReadStream(photoPath), { filename: 'dp.png' });

    const response = await axios.post(`https://api.telegram.org/bot${token}/setMyProfilePhoto`, form, {
      headers: form.getHeaders(),
    });

    if (response.data.ok) {
      console.log("Profile picture set successfully!");
    } else {
      console.error("Failed to set profile picture:", response.data);
    }
  } catch (error) {
    console.error("Error setting profile picture:", error);
  } finally {
    process.exit(0);
  }
}

setProfilePicture();
