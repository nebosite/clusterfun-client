const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  name: "Production Library Export",
  mode: "development",
  entry: './lib.ts',
  devtool: 'inline-source-map',
  context: path.resolve(__dirname, 'src'),
  
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
            loader: 'ts-loader',
            options: {
                "compilerOptions": {
                    "noEmit": false,
                }
            }
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: 'css-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        use: ['file-loader'],
      },
    ],
  },
  externals: [
    "react",
    "react-dom",
    "mobx-react-lite"
  ],
  resolve: {
    extensions: [ '.tsx', '.ts', '.js', '.css' ],
  },
  output: {
    filename: 'lib.js',
    path: path.resolve(__dirname, 'lib'),
  },
};

