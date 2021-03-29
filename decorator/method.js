require('reflect-metadata')

const METHODS = ['Get', 'Post', 'Delete', 'Put', 'Patch']

function Route(httpMethod, url) {
  httpMethod = httpMethod.toLowerCase()
  if (!METHODS.map(s => s.toLowerCase()).includes(httpMethod)) {
    throw new Error(
      `httpMethod expected at ${METHODS}, but got a ${httpMethod}`
    )
  }

  return function (target, key) {
    // get old data
    const routeFromDecorator =
      Reflect.getMetadata('routeFromDecorator', target) || {}

    if (!routeFromDecorator[httpMethod]) routeFromDecorator[httpMethod] = {}

    routeFromDecorator[httpMethod][url || key] = target[key]

    Reflect.defineMetadata('routeFromDecorator', routeFromDecorator, target)
  }
}

const methods = {}

METHODS.forEach(item => {
  methods[item] = url => Route(item, url)
})

module.exports = {
  Route,
  ...methods
}
