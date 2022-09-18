const proxy = require("http-proxy-middleware");

console.log("PROXY WOW")

module.exports = function (app) {
  console.log("SETTING PROXIES")
  app.use(
    proxy("/api", {       
      target: "http://localhost:8080",
      changeOrigin: true,
    })
  );
  app.use(
    proxy("/talk", {         
      target: "http://localhost:8080",
      ws: true,
      changeOrigin: true
    })
  );
};