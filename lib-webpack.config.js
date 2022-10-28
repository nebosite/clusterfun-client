const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  name: "Production Library Export",
  mode: "development",
  entry: './lib.ts',
  devtool: 'inline-source-map',
  context: path.resolve(__dirname, 'src'),
  
  experiments: {
    outputModule: true
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
            loader: 'ts-loader',
            options: {
                "compilerOptions": {
                    "noEmit": false,
                    "declaration": true,
                    "declarationDir": "lib"
                }
            }
        },
        exclude: [
          /node_modules/,
          /index.tsx/
        ]
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
    "react-device-detect",
    "react-ga4",
    "mobx",
    "mobx-react",
    "mobx-react-lite"
  ],
  resolve: {
    extensions: [ '.tsx', '.ts', '.js', '.css' ],
    fallback: { "zlib": require.resolve("browserify-zlib") }
  },
  output: {
    library: {
      type: "module"
    },
    environment: {
      // The environment supports arrow functions ('() => { ... }').
      arrowFunction: true,
      // The environment supports BigInt as literal (123n).
      bigIntLiteral: false,
      // The environment supports const and let for variable declarations.
      const: true,
      // The environment supports destructuring ('{ a, b } = obj').
      destructuring: true,
      // The environment supports an async import() function to import EcmaScript modules.
      dynamicImport: true,
      // The environment supports 'for of' iteration ('for (const x of array) { ... }').
      forOf: true,
      // The environment supports ECMAScript Module syntax to import ECMAScript modules (import ... from '...').
      module: true,
      // The environment supports optional chaining ('obj?.a' or 'obj?.()').
      optionalChaining: true,
      // The environment supports template literals.
      templateLiteral: true,
    },
    filename: 'lib.js',
    path: path.resolve(__dirname, 'lib'),
  },
};

