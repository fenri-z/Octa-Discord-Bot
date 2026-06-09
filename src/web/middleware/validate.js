/**
 * middleware/validate.js
 * Converts express-validator errors into a standard JSON 400 response.
 * Usage: add handleValidation after a body(...) chain in a route.
 */

const { validationResult } = require('express-validator');

function handleValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const first = errors.array({ onlyFirstError: true })[0];
        return res.status(400).json({ success: false, message: first.msg });
    }
    next();
}

module.exports = { handleValidation };
