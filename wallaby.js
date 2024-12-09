module.exports = () => {
  process.env.NODE_ENV = 'test'

  return {
    files: ['app/**/*.js'],

    tests: ['test/**/*.test.js'],

    testFramework: 'mocha',

    env: {
      type: 'node'
    }
  }
}
