# FavvyVision

FavvyVision is a web application built with Express.js that fetches the favicon (shortcut icon) from different websites. It provides a simple API endpoint to retrieve favicons based on the URL of the website.

## Usage

To fetch the favicon of a website, make a GET request to the following endpoint:

https://favvyvision.onrender.com/favicon?url=<website_url>

Replace `<website_url>` with the URL of the website you want to fetch the favicon for.

### Example

To fetch the favicon for "https://www.chess.com/", make a GET request to:

https://favvyvision.onrender.com/favicon?url=https://www.chess.com/


## Technologies Used

- Express.js
- Node.js

## Setup

To set up and run the application locally, follow these steps:

1. Clone this repository.
2. Navigate to the project directory.
3. Install dependencies with `npm install`.
4. Start the server with `npm start`.
5. The server will start running on `http://localhost:3000`.

## API Endpoint

- **GET /favicon**
  - **Query Parameters:**
    - `url`: The URL of the website to fetch the favicon for.
  - **Response:**
    - Returns the favicon of the specified website.

## Notes

- Only the `/favicon` endpoint is supported. Any other paths will result in a 404 error.

