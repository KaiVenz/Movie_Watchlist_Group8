
const watchlist = document.getElementById("watchlist");
const searchResults = document.getElementById("searchResults");
const message = document.getElementById("message");

let movies = [];

// Escape text before placing it into HTML
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? "message error" : "message";

  setTimeout(() => {
    message.classList.add("hidden");
  }, 3500);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong.");
  }

  return data;
}

function posterHTML(poster, title) {
  if (poster) {
    return `<img class="poster"
      src="${escapeHTML(poster)}"
      alt="${escapeHTML(title)} poster"
      onerror="this.outerHTML='<div class=&quot;poster-placeholder&quot;>No poster available</div>'">`;
  }

  return `<div class="poster-placeholder">No poster available</div>`;
}

// Load movies from the database
async function loadMovies() {
  try {
    movies = await request("/api/movies");
    renderMovies();
    updateStats();
  } catch (error) {
    showMessage(error.message, true);
  }
}

// Update the dashboard counters
function updateStats() {
  const watched = movies.filter(movie => movie.watched).length;

  document.getElementById("totalCount").textContent = movies.length;
  document.getElementById("watchedCount").textContent = watched;
  document.getElementById("unwatchedCount").textContent =
    movies.length - watched;
}

// Display saved movies with search, filter, and sorting
function renderMovies() {
  const search = document.getElementById("filterInput")
    .value.trim().toLowerCase();

  const status = document.getElementById("statusFilter").value;
  const sort = document.getElementById("sortSelect").value;

  let filtered = movies.filter(movie => {
    const matchesTitle = movie.title.toLowerCase().includes(search);

    const matchesStatus =
      status === "all" ||
      (status === "watched" && movie.watched) ||
      (status === "unwatched" && !movie.watched);

    return matchesTitle && matchesStatus;
  });

  if (sort === "title") {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === "year") {
    filtered.sort((a, b) => Number(b.year) - Number(a.year));
  } else {
    filtered.sort((a, b) => b.id - a.id);
  }

  if (filtered.length === 0) {
    watchlist.innerHTML =
      `<div class="empty-state">
        <h3>Your watchlist is empty</h3>
        <p>Add a movie or change your search filters.</p>
      </div>`;
    return;
  }

  watchlist.innerHTML = filtered.map(movie => `
    <article class="movie-card">
      ${posterHTML(movie.poster, movie.title)}
      <div class="movie-info">
        <h3>${escapeHTML(movie.title)}</h3>
        <p>${escapeHTML(movie.year)} · ${escapeHTML(movie.genre)}</p>
        <span class="status ${movie.watched ? "" : "to-watch"}">
          ${movie.watched ? "Watched" : "To Watch"}
        </span>

        <div class="movie-actions">
          <button class="secondary"
            onclick="toggleWatched(${movie.id})">
            ${movie.watched ? "Mark To Watch" : "Mark Watched"}
          </button>
          <button class="secondary"
            onclick="openEdit(${movie.id})">Edit</button>
          <button class="secondary"
            onclick="showDetails(${movie.id})">Details</button>
          <button class="danger"
            onclick="deleteMovie(${movie.id})">Delete</button>
        </div>
      </div>
    </article>
  `).join("");
}

// Add a movie manually
document.getElementById("addForm").addEventListener("submit",
  async event => {
    event.preventDefault();

    const movie = {
      title: document.getElementById("movieTitle").value,
      genre: document.getElementById("movieGenre").value,
      year: document.getElementById("movieYear").value
    };

    try {
      await request("/api/movies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(movie)
      });

      event.target.reset();
      await loadMovies();
      showMessage("Movie added to your watchlist!");
    } catch (error) {
      showMessage(error.message, true);
    }
  }
);

// Search OMDb
document.getElementById("searchForm").addEventListener("submit",
  async event => {
    event.preventDefault();

    const title = document.getElementById("searchInput").value.trim();
    searchResults.innerHTML = `<p>Searching...</p>`;

    try {
      const results = await request(
        `/api/lookup?title=${encodeURIComponent(title)}`
      );

      if (results.length === 0) {
        searchResults.innerHTML =
          `<div class="empty-state">No movies found. Try another title.</div>`;
        return;
      }

      searchResults.innerHTML = results.map(movie => `
        <article class="movie-card">
          ${posterHTML(movie.poster, movie.title)}
          <div class="movie-info">
            <h3>${escapeHTML(movie.title)}</h3>
            <p>${escapeHTML(movie.year)} · ${escapeHTML(movie.type)}</p>
            <div class="movie-actions">
              <button onclick="addSearchMovie(
                '${escapeHTML(movie.imdbID)}',
                '${escapeHTML(movie.title).replace(/'/g, "&#39;")}',
                '${escapeHTML(movie.year)}',
                '${escapeHTML(movie.poster)}'
              )">Add to Watchlist</button>
              <button class="secondary"
                onclick="showOnlineDetails('${escapeHTML(movie.imdbID)}')">
                Details
              </button>
            </div>
          </div>
        </article>
      `).join("");
    } catch (error) {
      searchResults.innerHTML = "";
      showMessage(error.message, true);
    }
  }
);

// Add a movie selected from OMDb
async function addSearchMovie(imdbID, title, year, poster) {
  try {
    const details = await request(`/api/movie/${encodeURIComponent(imdbID)}`);

    await request("/api/movies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        year,
        genre: details.Genre && details.Genre !== "N/A"
          ? details.Genre : "Unknown",
        poster: poster === "N/A" ? "" : poster,
        imdbID
      })
    });

    await loadMovies();
    showMessage("Movie added from OMDb!");
  } catch (error) {
    showMessage(error.message, true);
  }
}

// Open the edit dialog
function openEdit(id) {
  const movie = movies.find(item => item.id === id);
  if (!movie) return;

  document.getElementById("editId").value = movie.id;
  document.getElementById("editTitle").value = movie.title;
  document.getElementById("editGenre").value = movie.genre;
  document.getElementById("editYear").value = movie.year;

  document.getElementById("editDialog").showModal();
}

// Save edited movie
document.getElementById("editForm").addEventListener("submit",
  async event => {
    event.preventDefault();

    const id = document.getElementById("editId").value;

    try {
      await request(`/api/movies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.getElementById("editTitle").value,
          genre: document.getElementById("editGenre").value,
          year: document.getElementById("editYear").value
        })
      });

      document.getElementById("editDialog").close();
      await loadMovies();
      showMessage("Movie updated successfully!");
    } catch (error) {
      showMessage(error.message, true);
    }
  }
);

document.getElementById("cancelEdit").addEventListener("click", () => {
  document.getElementById("editDialog").close();
});

// Delete a movie after confirmation
async function deleteMovie(id) {
  const movie = movies.find(item => item.id === id);
  if (!movie) return;

  if (!confirm(`Remove "${movie.title}" from your watchlist?`)) {
    return;
  }

  try {
    await request(`/api/movies/${id}`, { method: "DELETE" });
    await loadMovies();
    showMessage("Movie deleted.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

// Toggle watched status
async function toggleWatched(id) {
  const movie = movies.find(item => item.id === id);
  if (!movie) return;

  try {
    await request(`/api/movies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watched: !movie.watched })
    });

    await loadMovies();
    showMessage("Watch status updated.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

// Show details for a saved movie
async function showDetails(id) {
  const movie = movies.find(item => item.id === id);
  if (!movie) return;

  if (movie.imdbID) {
    await showOnlineDetails(movie.imdbID);
    return;
  }

  document.getElementById("detailsContent").innerHTML = `
    <h2>${escapeHTML(movie.title)}</h2>
    <p>Year: ${escapeHTML(movie.year)}</p>
    <p>Genre: ${escapeHTML(movie.genre)}</p>
    <p>Status: ${movie.watched ? "Watched" : "To Watch"}</p>
  `;

  document.getElementById("detailsDialog").showModal();
}

// Load extended OMDb details
async function showOnlineDetails(imdbID) {
  try {
    const movie = await request(
      `/api/movie/${encodeURIComponent(imdbID)}`
    );

    document.getElementById("detailsContent").innerHTML = `
      ${posterHTML(movie.Poster !== "N/A" ? movie.Poster : "", movie.Title)}
      <h2>${escapeHTML(movie.Title)}</h2>
      <p><strong>Year:</strong> ${escapeHTML(movie.Year)}</p>
      <p><strong>Genre:</strong> ${escapeHTML(movie.Genre)}</p>
      <p><strong>Runtime:</strong> ${escapeHTML(movie.Runtime)}</p>
      <p><strong>IMDb rating:</strong> ${escapeHTML(movie.imdbRating)}</p>
      <p><strong>Plot:</strong> ${escapeHTML(movie.Plot)}</p>
    `;

    document.getElementById("detailsDialog").showModal();
  } catch (error) {
    showMessage(error.message, true);
  }
}

document.getElementById("closeDetails").addEventListener("click", () => {
  document.getElementById("detailsDialog").close();
});

// Update the visible list whenever filters change
document.getElementById("filterInput").addEventListener("input", renderMovies);
document.getElementById("statusFilter").addEventListener("change", renderMovies);
document.getElementById("sortSelect").addEventListener("change", renderMovies);

// Start the application
loadMovies();