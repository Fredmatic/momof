const express = require("express");
const cors = require("cors");
const session = require("express-session");
const bcrypt = require("bcrypt");

const app = express();

const bookings = [];

const users = [];

app.use(cors({
    origin: "http://127.0.0.1:5500",
    credentials: true
}));

app.use(express.json());

app.use(session({
    secret: "momo-beauty-secret",
    resave: false,
    saveUninitialized: false
}));
function requireLogin(req, res, next) {

    if (!req.session.user) {
        return res.status(401).json({
            message: "Unauthorized."
        });
    }

    next();
}
function requireAdmin(req, res, next) {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).json({
            message: "Admin access required."
        });
    }

    next();
}

app.get("/", (req, res) => {
    res.send("MOMO's PALOR server is running!");
});
app.post("/bookings", (req, res) => {

    const booking = req.body;

    const existingBooking = bookings.find(existingBooking =>
        existingBooking.service === booking.service &&
        existingBooking.date === booking.date &&
        existingBooking.time === booking.time &&
        existingBooking.status !== "cancelled"
    );

    if (existingBooking) {

        return res.status(409).json({
            message: "This time slot is already booked."
        });

    }

    bookings.push(booking);

    console.log("New booking received:");
    console.log(booking);

    res.json({
        message: "Booking received successfully"
    });

});

app.get("/bookings", requireAdmin, (req, res) => {
    res.json(bookings);
});
app.patch("/bookings/:reference", requireAdmin, (req, res) => {

    const reference = req.params.reference;
    const newStatus = req.body.status;

    const booking = bookings.find(
        booking => booking.reference === reference
    );

    if (!booking) {
        return res.status(404).json({
            message: "Booking not found"
        });
    }

    booking.status = newStatus;

    res.json({
        message: "Booking status updated",
        booking: booking
    });

});
app.post("/register", async (req, res) => {

    const { username, password } = req.body;

    const existingUser = users.find(user =>
        user.username === username
    );

    if (existingUser) {
        return res.status(409).json({
            message: "Username already exists."
        });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
        username: username,
        password: hashedPassword,
        role: "customer"
    };

    users.push(newUser);

    req.session.user = {
        username: newUser.username,
        role: newUser.role
    };

    res.json({
        message: "Account created successfully.",
        username: newUser.username,
        role: newUser.role
    });

});
app.post("/login", async (req, res) => {

    const { username, password } = req.body;

    const user = users.find(user =>
        user.username === username
    );

    if (!user) {
        return res.status(401).json({
            message: "Invalid username or password."
        });
    }

    const passwordMatch = await bcrypt.compare(
        password,
        user.password
    );

    if (!passwordMatch) {
        return res.status(401).json({
            message: "Invalid username or password."
        });
    }

    if (!user) {
        return res.status(401).json({
            message: "Invalid username or password."
        });
    }

    req.session.user = {
        username: user.username,
        role: user.role
    };

    res.json({
        message: "Login successful",
        username: user.username,
        role: user.role
    });

});
app.get("/check-login", (req, res) => {

    if (!req.session.user) {
        return res.status(401).json({
            message: "You are not logged in."
        });
    }

    res.json({
        loggedIn: true,
        username: req.session.user.username,
        role: req.session.user.role
    });

});
app.post("/logout", (req, res) => {

    req.session.destroy((error) => {

        if (error) {
            return res.status(500).json({
                message: "Logout failed."
            });
        }

        res.json({
            message: "Logout successful."
        });

    });

});
app.post("/create-admin", async (req, res) => {

    const { username, password } = req.body;

    const existingAdmin = users.find(user =>
        user.role === "admin"
    );

    if (existingAdmin) {
        return res.status(403).json({
            message: "An admin account already exists."
        });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = {
        username: username,
        password: hashedPassword,
        role: "admin"
    };

    users.push(admin);

    res.json({
        message: "Admin account created successfully."
    });

});
app.listen(3000, () => {
    console.log("Server is running on port 3000");
});