
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// READ - get all movies
app.get("/api/movies", (req, res) => {
  res.json(db.read());
});

// CREATE - add a movie
app.post("/api/movies", (req, res) => {
  const { title, genre, year } = req.body;

  if (!title?.trim() || !genre?.trim() || !year) {
    return res.status(400).json({
      message: "Title, genre, and year are required."
    });
  }

  const movies = db.read();

  const duplicate = movies.some(
    movie => movie.title.toLowerCase() === title.trim().toLowerCase()
  );

  if (duplicate) {
    return res.status(409).json({
      message: "This movie is already in your watchlist."
    });
  }

  const movie = {
    id: Date.now(),
    title: title.trim(),
    genre: genre.trim(),
    year: String(year).trim(),
    watched: false,
    poster: req.body.poster || "",
    imdbID: req.body.imdbID || ""
  };

  movies.push(movie);
  db.write(movies);

  res.status(201).json(movie);
});

// UPDATE - edit a movie
app.put("/api/movies/:id", (req, res) => {
  const movies = db.read();
  const movie = movies.find(
    item => item.id === Number(req.params.id)
  );

  if (!movie) {
    return res.status(404).json({
      message: "Movie not found."
    });
  }

  const { title, genre, year, watched } = req.body;

  if (title !== undefined) {
    if (!title.trim()) {
      return res.status(400).json({
        message: "Title cannot be empty."
      });
    }
    movie.title = title.trim();
  }

  if (genre !== undefined) movie.genre = genre.trim();
  if (year !== undefined) movie.year = String(year).trim();
  if (watched !== undefined) movie.watched = Boolean(watched);

  db.write(movies);
  res.json(movie);
});

// DELETE - remove a movie
app.delete("/api/movies/:id", (req, res) => {
  const movies = db.read();
  const updatedMovies = movies.filter(
    movie => movie.id !== Number(req.params.id)
  );

  if (movies.length === updatedMovies.length) {
    return res.status(404).json({
      message: "Movie not found."
    });
  }

  db.write(updatedMovies);
  res.json({ message: "Movie deleted successfully." });
});

// OMDb LOOKUP - search movies online
app.get("/api/lookup", async (req, res) => {
  try {
    const title = req.query.title;

    if (!title || !title.trim()) {
      return res.status(400).json({
        message: "Please enter a movie title."
      });
    }

    if (!process.env.OMDB_API_KEY) {
      return res.status(500).json({
        message: "OMDb API key is not configured."
      });
    }

    const response = await axios.get(
      "https://www.omdbapi.com/",
      {
        params: {
          apikey: process.env.OMDB_API_KEY,
          s: title.trim()
        }
      }
    );

    if (response.data.Response === "False") {
      return res.json([]);
    }

    const results = response.data.Search.map(movie => ({
      imdbID: movie.imdbID,
      title: movie.Title,
      year: movie.Year,
      type: movie.Type,
      poster: movie.Poster !== "N/A" ? movie.Poster : ""
    }));

    res.json(results);
  } catch (error) {
    console.error("OMDb lookup failed:", error.message);

    res.status(500).json({
      message: "Could not connect to OMDb. Please try again."
    });
  }
});

// Get detailed information for a selected movie
app.get("/api/movie/:imdbID", async (req, res) => {
  try {
    const response = await axios.get(
      "https://www.omdbapi.com/",
      {
        params: {
          apikey: process.env.OMDB_API_KEY,
          i: req.params.imdbID,
          plot: "short"
        }
      }
    );

    if (response.data.Response === "False") {
      return res.status(404).json({
        message: "Movie details not found."
      });
    }

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      message: "Could not load movie details."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CineList running at http://localhost:${PORT}`);
});