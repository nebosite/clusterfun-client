const webpack = require('webpack-merge');
const common = require('./lib-webpack.config');

module.exports = webpack.merge(common, {
  mode: "development",
  devtool: "inline-source-map",
});