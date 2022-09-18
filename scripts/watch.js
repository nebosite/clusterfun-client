process.env.NODE_ENV = 'development'

const chalk = require("chalk");
const fs = require('fs-extra')
const paths = require('react-scripts/config/paths')
const webpack = require('webpack')
const webpackconfig = require('react-scripts/config/webpack.config.js')
if(!webpackconfig.rules) webpackconfig.rules = [];
webpackconfig.rules.push({
    test: /\.(ts|tsx)$/,
    enforce: 'pre',
    use: [
      {
        options: {
          eslintPath: require.resolve('eslint'),
          cache: false,
        },
        loader: require.resolve('eslint-loader'),
      },
    ],
    exclude: /node_modules/,
  })

const config = webpackconfig('production')


console.log("WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW")
console.log(" WATCHING");

// work with react-app-rewire and customize-cra
const overrides = require('../config-overrides')
overrides(config, process.env.NODE_ENV)

// removes react-dev-utils/webpackHotDevClient.js at first in the array
if(config.entry.filter) {
    config.entry = config.entry.filter(i => !i.match(/webpackHotDevClient/))
}

if(config.plugins){
    config.plugins = config.plugins.filter(
    (plugin) => !(plugin instanceof webpack.HotModuleReplacementPlugin)
    )    
}

// to speed up rebuild time
config.mode = 'production'
config.devtool = 'eval-source-map'
//delete config.optimization

// fix publicPath and output path
//config.output.publicPath = pkg.homepage
config.output.path = paths.appBuild
//console.log(`App Build: ${paths.appBuild}`)

var watchOptions = {
    aggregateTimeout: 1000,
    //poll: 1000,
    ignored: ['node_modules/**'],
}

fs.unlink(".eslintcache", ()=>{})
webpack(config).watch(watchOptions, (err, stats) => {
    if (err) {
        console.error(err)
    } else {
        copyPublicFolder()
    }

    let json = stats.toJson();

    if (stats.hasWarnings()) {
        console.log(chalk.yellow("================\n WARNINGS\n================  "));
        console.error("    " + json.warnings.join("    \n"));
    }
    if (stats.hasErrors()) {
        console.log(chalk.redBright("================\n ERRORS\n================ "));
        console.error("    " + json.errors.join("    \n"));
        console.log(chalk.redBright("Failed"));
    }
    else {
        console.log(chalk.greenBright("Success!"));
    }
    console.log("\n--- DONE BUILDING ---\n")
    fs.unlink(".eslintcache", ()=>{})
    // console.error(
    //     stats.toString({
    //       chunks: false,
    //       colors: true,
    //     }))
})

// copy stuff from public to build folder
function copyPublicFolder() {
    
  fs.copySync(paths.appPublic, paths.appBuild, {
    dereference: true,
    filter: (file) => file !== paths.appHtml,
  })
}