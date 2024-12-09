const app = require('../app/app')
const request = require('supertest').agent(app.listen())

describe('GET / (health check)', () => {
  it('should have GET root for k8s health check', done => {
    request
      .get('/')
      .expect(200)
      .end(done)
  })
})
