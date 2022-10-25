const webpack = require('webpack-merge');
const common = require('./lib-webpack.config');

module.exports = webpack.merge(common, {
  mode: "production",
  devtool: "source-map",
});