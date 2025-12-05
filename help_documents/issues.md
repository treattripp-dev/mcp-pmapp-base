# Vercel Prod Issue

**Description:**

There is an "Uncaught SyntaxError: Unexpected token '<'" error in the Vercel production environment. This is likely due to a misconfiguration in the server-side routing, causing an HTML file to be served instead of a JavaScript file.

**Image of the issue:**

![Issue](images/task32.png)

**Solution:**
The issue is in the `server.js` file. The solution is to add the correct content type for the `.js` files in the production environment.

```javascript
app.get('/*.js', (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        res.type('text/javascript');
    }
    next();
});
```
