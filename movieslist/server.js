require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const db = require("./db");

const app = express();

const USERS_FILE = path.join(__dirname, "users.json");

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "[]");
}

function getUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, "utf8");
    return data.trim() ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Helper to safely find static files across project structures
function getPublicFilePath(filename) {
  const localPath = path.join(__dirname, "public", filename);
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  return path.join(__dirname, "..", "public", filename);
}

// ==========================================
// MIDDLEWARE CONFIGURATION
// ==========================================
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "cinelist-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24
  }
}));

// SERVE STATIC FILES (Supports root or nested subfolder setups)
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "..", "public")));

// ==========================================
// CONSTANTS & HELPERS
// ==========================================
const FEATURED_TITLES = [
  "The Dark Knight",
  "Inception",
  "Interstellar",
  "Avengers: Endgame",
  "Dune: Part Two",
  "The Shawshank Redemption",
  "Spider-Man: Across the Spider-Verse",
  "Oppenheimer",
  "Whiplash",
  "Parasite"
];

const featuredCache = new Map();
const trailerSearchCache = new Map();
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const TMDB_API_KEY = (process.env.TMDB_API_KEY || "").trim();

function formatTrailerResult(videoId, title) {
  const sanitizedId = typeof videoId === "string" ? videoId.trim() : "";
  const validId = YOUTUBE_VIDEO_ID_PATTERN.test(sanitizedId) ? sanitizedId : "";

  return {
    videoId: validId,
    title: typeof title === "string" ? title : "",
    watchUrl: validId ? `https://www.youtube.com/watch?v=${validId}` : "",
    embeddable: Boolean(validId)
  };
}

async function isEmbeddable(videoId) {
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) return false;

  try {
    const response = await axios.get("https://www.youtube.com/oembed", {
      params: { url: `https://www.youtube.com/watch?v=${videoId}`, format: "json" },
      timeout: 8000,
      validateStatus: null
    });

    return response.status === 200;
  } catch (error) {
    return error.response?.status === 401 ? false : true;
  }
}

async function firstEmbeddableCandidate(candidates) {
  for (const candidate of candidates.slice(0, 5)) {
    if (await isEmbeddable(candidate.videoId)) {
      return candidate;
    }
  }

  return null;
}

// ==========================================
// ROUTES - AUTHENTICATION & STATIC FALLBACKS
// ==========================================

app.get("/login.html", (req, res) => {
  const filePath = getPublicFilePath("login.html");
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.status(404).send("login.html not found");
});

app.get("/login", (req, res) => {
  res.redirect("/login.html");
});

app.get("/", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect("/login.html");
  }

  const filePath = getPublicFilePath("index.html");
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.status(404).send("index.html not found");
});

// LOGIN route
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required."
      });
    }

    const users = getUsers();
    const user = users.find(
      u => u.username.toLowerCase() === username.toLowerCase()
    );

    if (!user) {
      return res.status(401).json({
        message: "Invalid username or password."
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid username or password."
      });
    }

    req.session.user = {
      id: user.id,
      username: user.username
    };

    res.json({
      message: "Login successful.",
      user: req.session.user
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Login failed."
    });
  }
});

// LOGOUT route
app.post("/api/logout", (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        message: "Logout failed."
      });
    }
    res.clearCookie("connect.sid");
    res.json({
      message: "Logged out successfully."
    });
  });
});

// REGISTER route
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required."
      });
    }

    const users = getUsers();

    const existingUser = users.find(
      u => u.username.toLowerCase() === username.toLowerCase()
    );

    if (existingUser) {
      return res.status(409).json({
        message: "Username is already taken."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: Date.now(),
      username: username.trim(),
      password: hashedPassword
    };

    users.push(newUser);
    saveUsers(users);

    res.status(201).json({
      message: "Account created successfully."
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Registration failed."
    });
  }
});

// GET CURRENT USER route
app.get("/api/me", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      message: "Not authenticated."
    });
  }

  res.json({
    user: req.session.user
  });
});

// ==========================================
// MOVIE DATA & UTILITIES
// ==========================================

async function enrichMovieWithMetadata(movie) {
  if (!movie || movie.imdbRating || !process.env.OMDB_API_KEY) {
    return movie;
  }

  try {
    const response = await axios.get("https://www.omdbapi.com/", {
      params: {
        apikey: process.env.OMDB_API_KEY,
        ...(movie.imdbID
          ? { i: movie.imdbID }
          : { t: movie.title, y: movie.year || undefined })
      }
    });
    const details = response.data;

    if (details?.Response === "True") {
      movie.imdbRating = details.imdbRating && details.imdbRating !== "N/A"
        ? details.imdbRating : "N/A";

      if (!movie.poster && details.Poster && details.Poster !== "N/A") {
        movie.poster = details.Poster;
      }

      if (!movie.imdbID && details.imdbID) {
        movie.imdbID = details.imdbID;
      }

      if ((!movie.genre || movie.genre === "Unknown") && details.Genre) {
        movie.genre = details.Genre;
      }
    }
  } catch (error) {
    console.warn(`Could not load OMDb rating for ${movie.title}:`, error.message);
  }

  return movie;
}

// READ - get movies ONLY for the logged-in user
app.get("/api/movies", async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const allMovies = db.read();
  
  const userMovies = allMovies.filter(
    movie => movie.userId === req.session.user.id
  );

  const enrichedMovies = await Promise.all(
    userMovies.map(movie => enrichMovieWithMetadata(movie))
  );

  db.write(allMovies);
  res.json(enrichedMovies);
});

// FEATURED - homepage picks
app.get("/api/featured", async (req, res) => {
  try {
    const cached = db.readFeatured();
    if (cached.length > 0) {
      return res.json(cached);
    }

    if (!process.env.OMDB_API_KEY) {
      return res.status(500).json({
        message: "OMDb API key is not configured."
      });
    }

    const seedResults = await Promise.all(FEATURED_TITLES.map(async title => {
      if (featuredCache.has(title)) return featuredCache.get(title);

      const response = await axios.get("https://www.omdbapi.com/", {
        params: { apikey: process.env.OMDB_API_KEY, t: title, plot: "short" }
      });

      const details = response.data;
      const featured = details?.Response === "True" && details.Type === "movie"
        ? {
          imdbID: details.imdbID,
          title: details.Title,
          year: details.Year,
          poster: details.Poster && details.Poster !== "N/A" ? details.Poster : "",
          imdbRating: details.imdbRating && details.imdbRating !== "N/A"
            ? details.imdbRating : "",
          plot: details.Plot && details.Plot !== "N/A" ? details.Plot : "",
          genre: details.Genre && details.Genre !== "N/A" ? details.Genre : "",
          released: details.Released && details.Released !== "N/A" ? details.Released : "",
          runtime: details.Runtime && details.Runtime !== "N/A" ? details.Runtime : "",
          director: details.Director && details.Director !== "N/A" ? details.Director : "",
          writer: details.Writer && details.Writer !== "N/A" ? details.Writer : "",
          actors: details.Actors && details.Actors !== "N/A" ? details.Actors : "",
          language: details.Language && details.Language !== "N/A" ? details.Language : "",
          country: details.Country && details.Country !== "N/A" ? details.Country : "",
          awards: details.Awards && details.Awards !== "N/A" ? details.Awards : "",
          metascore: details.Metascore && details.Metascore !== "N/A" ? details.Metascore : "",
          imdbVotes: details.imdbVotes && details.imdbVotes !== "N/A" ? details.imdbVotes : "",
          boxOffice: details.BoxOffice && details.BoxOffice !== "N/A" ? details.BoxOffice : "",
          rated: details.Rated && details.Rated !== "N/A" ? details.Rated : ""
        }
        : null;

      featuredCache.set(title, featured);
      return featured;
    }));

    const featuredMovies = seedResults.filter(Boolean);

    if (featuredMovies.length === 0) {
      return res.status(502).json({
        message: "Could not load featured movies right now."
      });
    }

    db.writeFeatured(featuredMovies);
    res.json(featuredMovies);
  } catch (error) {
    console.error("Featured movies lookup failed:", error.message);
    res.status(500).json({
      message: "Could not load featured movies. Please try again."
    });
  }
});

const normalizeForCompare = value => String(value ?? "")
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/['’]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const extractYear = value => {
  const match = String(value ?? "").match(/\d{4}/);
  return match ? match[0] : "";
};

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

const ROMAN_NUMBERS = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5,
  vi: 6, vii: 7, viii: 8, ix: 9, x: 10
};

function extractPartNumber(value) {
  const text = String(value ?? "").toLowerCase();

  const partMatch = text.match(/\bpart\s+(\d+|[a-z]+)\b/);
  if (partMatch) {
    const token = partMatch[1];
    const numeric = /^\d+$/.test(token)
      ? Number(token)
      : WORD_NUMBERS[token];
    if (numeric) return numeric;
  }

  const romanMatch = text.match(/episode\s+([ivx]+)\b/);
  if (romanMatch && ROMAN_NUMBERS[romanMatch[1]]) {
    return ROMAN_NUMBERS[romanMatch[1]];
  }

  return null;
}

function toWatchlistShape(details) {
  const value = key =>
    typeof details[key] === "string" && details[key] !== "N/A" ? details[key] : "";

  return {
    title: value("Title"),
    genre: value("Genre"),
    year: value("Year"),
    poster: value("Poster"),
    imdbID: value("imdbID"),
    imdbRating: value("imdbRating"),
    plot: value("Plot"),
    rated: value("Rated"),
    released: value("Released"),
    runtime: value("Runtime"),
    director: value("Director"),
    writer: value("Writer"),
    actors: value("Actors"),
    language: value("Language"),
    country: value("Country"),
    awards: value("Awards"),
    ratings: Array.isArray(details.Ratings) ? details.Ratings : [],
    metascore: value("Metascore"),
    imdbVotes: value("imdbVotes"),
    type: value("Type"),
    boxOffice: value("BoxOffice")
  };
}

async function fetchOmdbDetails(imdbID) {
  const response = await axios.get("https://www.omdbapi.com/", {
    params: { apikey: process.env.OMDB_API_KEY, i: imdbID, plot: "short" }
  });

  return response.data?.Response === "True" ? response.data : null;
}

async function fetchOmdbSearch(title, year) {
  const response = await axios.get("https://www.omdbapi.com/", {
    params: {
      apikey: process.env.OMDB_API_KEY,
      s: title,
      ...(year ? { y: year } : {})
    }
  });

  if (response.data?.Response === "False") return [];

  return Array.isArray(response.data?.Search) ? response.data.Search : [];
}

// VALIDATE
app.post("/api/validate", async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const year = String(req.body?.year ?? "").trim();
  const genre = typeof req.body?.genre === "string" ? req.body.genre.trim() : "";

  if (!title) {
    return res.status(400).json({
      valid: false,
      reason: "empty",
      message: "Movie not found. Please enter a valid movie title."
    });
  }

  if (!process.env.OMDB_API_KEY) {
    return res.status(500).json({
      valid: false,
      reason: "omdb_key",
      message: "OMDb API key is not configured."
    });
  }

  try {
    let candidates = await fetchOmdbSearch(title, extractYear(year));

    if (candidates.length === 0 && year) {
      const withoutYear = await fetchOmdbSearch(title, "");
      if (withoutYear.length > 0) {
        return res.status(422).json({
          valid: false,
          reason: "year",
          message: "The movie year does not match the OMDb data.",
          closestTitle: withoutYear[0].Title,
          actualYear: withoutYear[0].Year
        });
      }
    }

    if (candidates.length === 0) {
      return res.status(404).json({
        valid: false,
        reason: "not_found",
        message: "Movie not found. Please enter a valid movie title."
      });
    }

    const normalizedTitle = normalizeForCompare(title);
    const exactMatch = candidates.find(candidate =>
      normalizeForCompare(candidate.Title) === normalizedTitle
    );

    const chosen = exactMatch || candidates[0];
    const details = await fetchOmdbDetails(chosen.imdbID);

    if (!details) {
      return res.status(404).json({
        valid: false,
        reason: "not_found",
        message: "Movie not found. Please enter a valid movie title."
      });
    }

    if (details.Type && details.Type !== "movie") {
      return res.status(422).json({
        valid: false,
        reason: "not_movie",
        message: `"${details.Title}" is a ${details.Type}, not a movie.`
      });
    }

    if (year) {
      const submittedYear = extractYear(year);
      const actualYear = extractYear(details.Year) || extractYear(details.Released);

      if (submittedYear !== actualYear) {
        return res.status(422).json({
          valid: false,
          reason: "year",
          message: "The movie year does not match the OMDb data.",
          actualYear: actualYear
        });
      }
    }

    if (genre) {
      const omdbGenres = String(details.Genre || "")
        .split(",")
        .map(normalizeForCompare)
        .filter(Boolean);
      const submittedGenre = normalizeForCompare(genre);

      if (!omdbGenres.includes(submittedGenre)) {
        return res.status(422).json({
          valid: false,
          reason: "genre",
          message: "The movie genre does not match the OMDb data.",
          actualGenre: details.Genre
        });
      }
    }

    res.json({ valid: true, movie: toWatchlistShape(details) });
  } catch (error) {
    console.error("Validation failed:", error.message);
    res.status(500).json({
      valid: false,
      reason: "lookup_failed",
      message: "Could not verify this movie with OMDb. Please try again."
    });
  }
});

// CREATE - add a movie for the current user
app.post("/api/movies", async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const {
    title, genre, year, poster, imdbID, imdbRating, plot, rated, released,
    runtime, director, writer, actors, language, country, awards, ratings,
    metascore, imdbVotes, type, boxOffice
  } = req.body;

  const enteredTitle = typeof title === "string" ? title.trim() : "";
  const enteredGenre = typeof genre === "string" ? genre.trim() : "";
  const enteredYear = String(year ?? "").trim();
  const enteredImdbID = typeof imdbID === "string" ? imdbID.trim() : "";
  const metadataValue = value =>
    typeof value === "string" && value !== "N/A" ? value : "";

  if (!enteredTitle || !enteredGenre || !enteredYear) {
    return res.status(400).json({
      message: "Title, genre, and year are required."
    });
  }

  const movies = db.read();
  const normalizeTitle = value => String(value || "")
    .trim().replace(/\s+/g, " ").toLowerCase();

  const duplicate = movies.some(movie => {
    if (movie.userId !== req.session.user.id) return false;
    if (enteredImdbID && movie.imdbID && movie.imdbID === enteredImdbID) return true;

    return normalizeTitle(movie.title) === normalizeTitle(enteredTitle) &&
      String(movie.year) === enteredYear;
  });

  if (duplicate) {
    return res.status(409).json({
      message: "This movie is already in your watchlist."
    });
  }

  const movie = {
    id: Date.now(),
    userId: req.session.user.id,
    title: enteredTitle,
    genre: enteredGenre,
    year: enteredYear,
    watched: false,
    favorite: false,
    poster: typeof poster === "string" && poster !== "N/A" ? poster : "",
    imdbID: enteredImdbID,
    imdbRating: metadataValue(imdbRating),
    plot: metadataValue(plot),
    rated: metadataValue(rated),
    released: metadataValue(released),
    runtime: metadataValue(runtime),
    director: metadataValue(director),
    writer: metadataValue(writer),
    actors: metadataValue(actors),
    language: metadataValue(language),
    country: metadataValue(country),
    awards: metadataValue(awards),
    ratings: Array.isArray(ratings) ? ratings : [],
    metascore: metadataValue(metascore),
    imdbVotes: metadataValue(imdbVotes),
    type: metadataValue(type),
    boxOffice: metadataValue(boxOffice)
  };

  movies.push(movie);
  db.write(movies);

  res.status(201).json(movie);
});

// UPDATE - edit a movie
app.put("/api/movies/:id", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const movies = db.read();
  const movie = movies.find(
    item => item.id === Number(req.params.id) && item.userId === req.session.user.id
  );

  if (!movie) {
    return res.status(404).json({
      message: "Movie not found."
    });
  }

  const { title, genre, year, watched, favorite } = req.body;

  if (title !== undefined) {
    if (!title.trim()) {
      return res.status(400).json({
        message: "Title cannot be empty."
      });
    }
    const updatedTitle = title.trim();
    movie.title = updatedTitle;
  }

  if (genre !== undefined) movie.genre = genre.trim();
  if (year !== undefined) movie.year = String(year).trim();
  if (watched !== undefined) movie.watched = Boolean(watched);
  if (favorite !== undefined) movie.favorite = Boolean(favorite);

  db.write(movies);
  res.json(movie);
});

// DELETE - remove a movie
app.delete("/api/movies/:id", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const movies = db.read();
  const updatedMovies = movies.filter(
    movie => !(movie.id === Number(req.params.id) && movie.userId === req.session.user.id)
  );

  if (movies.length === updatedMovies.length) {
    return res.status(404).json({
      message: "Movie not found."
    });
  }

  db.write(updatedMovies);
  res.json({ message: "Movie deleted successfully." });
});

// OMDb LOOKUP
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

    const results = await Promise.all(response.data.Search.map(async movie => {
      let imdbRating = "N/A";
      let omdbDetails = {};

      try {
        const details = await axios.get("https://www.omdbapi.com/", {
          params: {
            apikey: process.env.OMDB_API_KEY,
            i: movie.imdbID
          }
        });

        if (details.data?.Response === "True") {
          omdbDetails = details.data;
          imdbRating = details.data.imdbRating || "N/A";
        }
      } catch (error) {
        console.warn(`Could not load OMDb rating for ${movie.Title}:`, error.message);
      }

      return {
        ...omdbDetails,
        imdbID: movie.imdbID,
        title: omdbDetails.Title || movie.Title,
        year: omdbDetails.Year || movie.Year,
        type: omdbDetails.Type || movie.Type,
        genre: omdbDetails.Genre && omdbDetails.Genre !== "N/A"
          ? omdbDetails.Genre
          : "Unknown",
        poster: omdbDetails.Poster && omdbDetails.Poster !== "N/A"
          ? omdbDetails.Poster
          : movie.Poster !== "N/A" ? movie.Poster : "",
        imdbRating
      };
    }));

    res.json(results);
  } catch (error) {
    console.error("OMDb lookup failed:", error.message);

    res.status(500).json({
      message: "Could not connect to OMDb. Please try again."
    });
  }
});

// TRAILER LOOKUP
app.get("/api/trailer", async (req, res) => {
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  const year = typeof req.query.year === "string" ? req.query.year.trim() : "";

  if (!title) {
    return res.status(400).json(formatTrailerResult("", ""));
  }

  const cacheKey = `${title.toLowerCase()}|${year}`;
  if (trailerSearchCache.has(cacheKey)) {
    return res.json(trailerSearchCache.get(cacheKey));
  }

  try {
    if (TMDB_API_KEY) {
      const searchResponse = await axios.get("https://api.themoviedb.org/3/search/movie", {
        params: {
          api_key: TMDB_API_KEY,
          query: title,
          year: year || undefined,
          include_adult: false
        },
        timeout: 12000
      });

      const movie = Array.isArray(searchResponse.data?.results)
        ? searchResponse.data.results.find(result => {
            const matchesYear = !year || String(result.release_date || "").startsWith(String(year));
            const sameTitle = normalizeForCompare(result.title || result.original_title || "") === normalizeForCompare(title);
            return matchesYear && (sameTitle || normalizeForCompare(result.title || result.original_title || "").includes(normalizeForCompare(title)));
          }) || searchResponse.data.results[0]
        : null;

      if (movie?.id) {
        const videoResponse = await axios.get(`https://api.themoviedb.org/3/movie/${movie.id}/videos`, {
          params: { api_key: TMDB_API_KEY },
          timeout: 12000
        });

        const trailer = Array.isArray(videoResponse.data?.results)
          ? [...videoResponse.data.results]
              .filter(video => video.site === "YouTube" && (video.type === "Trailer" || video.type === "Teaser"))
              .sort((first, second) => Number(second.official) - Number(first.official))[0]
          : null;

        if (trailer?.key && await isEmbeddable(trailer.key)) {
          const result = formatTrailerResult(trailer.key, trailer.name || title);
          trailerSearchCache.set(cacheKey, result);
          return res.json(result);
        }
      }
    }

    const response = await axios.get("https://www.youtube.com/results", {
      params: { search_query: `${title} ${year} official trailer`.trim() },
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 12000,
      maxContentLength: 5_000_000
    });

    const candidates = [...response.data.matchAll(
      /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/g
    )].slice(0, 40).map(match => {
      let videoTitle = match[2];
      try {
        videoTitle = JSON.parse(`"${videoTitle}"`);
      } catch {
        return null;
      }

      return { videoId: match[1], title: videoTitle };
    }).filter(candidate => candidate && YOUTUBE_VIDEO_ID_PATTERN.test(candidate.videoId));

    const titleWords = normalizeForCompare(title).split(/\s+/).filter(Boolean);
    const requestedPart = extractPartNumber(title);
    const hasYear = Boolean(extractYear(year));

    const baseWords = titleWords.filter(word =>
      word !== "part" && word !== "episode" && !(word in WORD_NUMBERS) &&
      !(word in ROMAN_NUMBERS)
    );

    const requiredWords = baseWords.length ? baseWords : titleWords;

    const rankedCandidates = candidates.map(candidate => {
      const normalizedCandidate = normalizeForCompare(candidate.title);
      const candidateWords = new Set(normalizedCandidate.split(/\s+/).filter(Boolean));
      const hasTrailerLabel = /trailer|teaser/i.test(candidate.title);

      const missingWords = requiredWords.filter(word => !candidateWords.has(word));
      const allWordsPresent = missingWords.length === 0;

      const contiguousMatch = normalizedCandidate.includes(normalizeForCompare(title));
      const startsWithTitle = normalizedCandidate.startsWith(normalizeForCompare(title));

      const candidatePart = extractPartNumber(candidate.title);
      const partConflict = requestedPart !== null && candidatePart !== null &&
        requestedPart !== candidatePart;

      const candidateYear = extractYear(candidate.title);
      const yearConflict = hasYear && candidateYear && candidateYear !== extractYear(year);

      const normalizedRequest = normalizeForCompare(title);
      const requestWords = new Set(normalizedRequest.split(/\s+/).filter(Boolean));
      const candidateMarker = candidate.title.match(
        /\b(no way home|far from home|homecoming|across the spider-?verse|into the spider-?verse|returns|reboot|revival)\b/i
      );
      const markerPhrase = candidateMarker
        ? normalizeForCompare(candidateMarker[1])
        : "";
      const sequelMarker = Boolean(markerPhrase) &&
        !requestWords.has(markerPhrase.split(" ")[0]);

      const titleStart = normalizedCandidate.indexOf(normalizeForCompare(title));
      const extraLeadingWords = titleStart > 0
        ? normalizedCandidate.slice(0, titleStart).split(/\s+/).filter(Boolean).length
        : 0;

      const score =
        (allWordsPresent ? 10 : 0) +
        (contiguousMatch ? 8 : 0) +
        (startsWithTitle ? 12 : 0) +
        (hasTrailerLabel ? 4 : 0) +
        (/official/i.test(candidate.title) ? 2 : 0) +
        (candidateYear && candidateYear === extractYear(year) ? 5 : 0) -
        (extraLeadingWords * 4) -
        missingWords.length * 8 -
        (partConflict ? 100 : 0) -
        (yearConflict ? 100 : 0);

      return {
        ...candidate,
        score,
        hasTrailerLabel,
        allWordsPresent,
        partConflict,
        yearConflict,
        sequelMarker
      };
    }).filter(candidate =>
      candidate.hasTrailerLabel &&
      candidate.allWordsPresent &&
      !candidate.partConflict &&
      !candidate.yearConflict &&
      !candidate.sequelMarker
    ).sort((first, second) => second.score - first.score);

    const chosen = await firstEmbeddableCandidate(rankedCandidates);
    const result = chosen
      ? formatTrailerResult(chosen.videoId, chosen.title)
      : formatTrailerResult("", "");

    trailerSearchCache.set(cacheKey, result);
    return res.json(result);
  } catch (error) {
    console.warn(`YouTube trailer lookup failed for ${title}:`, error.message);
    const unavailable = formatTrailerResult("", "");
    trailerSearchCache.set(cacheKey, unavailable);
    return res.json(unavailable);
  }
});

function findLocalMovieById(imdbID) {
  const localMovies = db.read();
  
  return localMovies.find(movie => movie.imdbID === imdbID)
    || db.readFeatured().find(movie => movie.imdbID === imdbID)
    || null;
}

// Get detailed information for a selected movie
app.get("/api/movie/:imdbID", async (req, res) => {
  const imdbID = req.params.imdbID;

  if (!process.env.OMDB_API_KEY) {
    const localMovie = findLocalMovieById(imdbID);
    if (localMovie) {
      return res.json(localMovie);
    }

    return res.status(503).json({
      message: "Movie details are temporarily unavailable. The OMDb API key is not configured."
    });
  }

  try {
    const response = await axios.get(
      "https://www.omdbapi.com/",
      {
        params: {
          apikey: process.env.OMDB_API_KEY,
          i: imdbID,
          plot: "short"
        }
      }
    );

    if (response.data.Response === "False") {
      const localMovie = findLocalMovieById(imdbID);
      if (localMovie) {
        return res.json(localMovie);
      }

      return res.status(404).json({
        message: "Movie details not found."
      });
    }

    res.json(response.data);
  } catch (error) {
    const localMovie = findLocalMovieById(imdbID);
    if (localMovie) {
      return res.json(localMovie);
    }

    res.status(500).json({
      message: "Could not load movie details."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CineList running at http://localhost:${PORT}`);
});