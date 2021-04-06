const path = require('path')
const http = require('http')
const createHttpError = require('http-errors')
const { object, integer, string, array, func, boolean, removeEmpty } = require('tegund')

const { routeMixin } = require('./mixin')
const { kidnapRes } = require('../middleware/kidnap')

const express = require('../helper/express')

const serverParamsInterface = object({
  port: integer().min(1024).max(65535).optional(),
  view: object({
    path: string(),
    engine: object({
      __express: 'function'
    }),
    type: string()
  }).optional(),
  middleware: array('function').optional(),
  errorMiddleware: array('function').optional(),
  controller: array('object', 'function').optional(),
  onServe: func().optional(),
  onClose: func().optional(),
  static: array(
    string(),
    object({ path: string(), maxAge: integer().optional() })
  ).optional(),
  silence: boolean().optional()
})

function defaultErrorHandler(err, req, res, next) {
  if (res.headersSent) return

  if (typeof err === 'number') {
    err = createHttpError(err)
  } else if (typeof err === 'string') {
    err = createHttpError(400, err)
  } else if (typeof err === 'object' && typeof err.status === 'number') {
    err = createHttpError(err.status, err.message)
  }

  if (!createHttpError.isHttpError(err)) {
    err = createHttpError(500)
  }

  res.json({
    code: err.status,
    message: err.message
  })
}

const Server = (params = {}) => Target => {
  serverParamsInterface.assert(params)
  return class extends Target {
    static silence = false

    constructor(args = {}) {
      super()

      serverParamsInterface.assert(args)

      Object.assign(params, args)

      Object.assign(this, routeMixin)

      // TODO params validate
      this.port = params.port || 3000
      this.view = params.view
      this.static = params.static
      this.middleware = params.middleware || []
      this.errorMiddleware = params.errorMiddleware || []

      this.onServeCallbacks = params.onServe ? [params.onServe] : []
      this.onCloseCallbacks = params.onClose ? [params.onClose] : []

      this._controller = params.controller || []
      this._silence = params.silence

      this.controller = {}

      this.init()
    }

    get runing() {
      return this.status()
    }

    get silence() {
      return this._silence !== undefined ? this._silence : Server.silence
    }

    init() {
      // configure app
      this.app = express()
      // set view
      if (this.view && this.view.path) {
        if (!this.view.engine || !this.view.type) {
          throw new Error('Please provide a views engine and mark file type')
        }
        this.app.set('views', path.resolve(this.view.path))
        this.app.set('view engine', this.view.type)
        this.app.engine(this.view.type, this.view.engine.__express)
      }

      // set port
      this.app.set('port', this.port)

      // set static
      if (this.static) {
        this.static.forEach(item => {
          if (typeof item === 'string') {
            item = { path: item }
          }

          this.app.use(
            express.static(
              item.path,
              removeEmpty({
                ...item,
                path: undefined
              })
            )
          )
        })
      }

      // encode request
      this.app.use(express.json())
      this.app.use(express.urlencoded({ extended: false }))

      // use kidnap middleware
      this.middleware.unshift(kidnapRes)
      // use middleware
      if (this.middleware.length > 0) this.app.use(...this.middleware)

      // assign app method to this
      this._mappingRouterMethod(this.app)
    }

    start() {
      return new Promise((resolve, reject) => {
        // assign decorator
        this._assignRouterFromDecorator()

        // init controller
        if (this._controller.length > 0) {
          this._controller.forEach(item => {
            const c = this.useController(item)

            this.controller[c.name] = c
          })
        }

        if (this.errorMiddleware.length > 0)
          this.app.use(...this.errorMiddleware)

        // catch 404 and forward to error handler
        this.app.use(function (req, res, next) {
          next(createHttpError(404))
        })

        // error handler
        this.app.use(defaultErrorHandler)

        // configure server
        this.server = http.createServer(this.app)
        // listen
        this.server.listen(this.port)
        // set error callback
        this.server.on('error', (...args) => {
          this._onError(...args)

          reject()
        })
        // set serve callback
        this.server.on('listening', (...args) => {
          this._onServe(...args)

          resolve()
        })
        this.server.on('close', this._onClose.bind(this))

        process.on('SIGINT', () => {
          this._onClose()

          process.exit(0)
        })
      })
    }

    stop() {
      if (!this.server) return Promise.reject()

      const promise = new Promise(resolve => {
        this.onCloseCallbacks.push(resolve)
      })

      this.server.close()

      return promise
    }

    status() {
      if (!this.server) return false

      return this.server.listening
    }

    useController(controller) {
      if (typeof controller === 'function') {
        const Controller = controller
        controller = new Controller()
      }

      if (typeof controller !== 'object' || !controller._isToteaController) {
        throw new Error('controller expected a valid ToteaController')
      }

      // if the controller is used
      if (
        Object.values(this.controller).filter(
          item => item.url === controller.url
        ).length > 0
      ) {
        throw new Error(
          `controler which url is ${controller.url} is already used`
        )
      }

      // assign controller to single controller
      controller.controllers = this.controller

      // assign server to single controller
      controller.server = this

      this.app.use(controller.url, controller.router)

      return controller
    }

    _onError(error) {
      if (error.syscall !== 'listen') {
        throw error
      }

      const bind =
        typeof this.port === 'string'
          ? 'Pipe ' + this.port
          : 'Port ' + this.port

      switch (error.code) {
        case 'EACCES':
          console.error(bind + ' requires elevated privileges')
          process.exit(1)
        case 'EADDRINUSE':
          console.error(bind + ' is already in use')
          process.exit(1)
        default:
          throw error
      }
    }

    _onServe() {
      const addr = this.server.address
      if (!Server.silence) console.log(`Listening on port ${this.port}`)

      // call onServe
      if (this.onServeCallbacks.length > 0) {
        this.onServeCallbacks.map(callback => callback(addr))
      }
    }

    _onClose() {
      if (!Server.silence) console.log(`Close listen on port ${this.port}`)

      // call onClose
      if (this.onCloseCallbacks.length > 0) {
        this.onCloseCallbacks.map(callback => callback())
      }
    }
  }
}

module.exports = {
  Server
}
