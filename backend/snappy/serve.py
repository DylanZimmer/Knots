import os

from draw_from_db import app


def should_use_production_server() -> bool:
    value = os.environ.get('SNAPPY_USE_WSGI')
    if value is not None:
        return value.strip().lower() in {'1', 'true', 'yes', 'on'}

    return os.environ.get('NODE_ENV') == 'production'


def run_dev_server() -> None:
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)


def run_server() -> None:
    if not should_use_production_server():
        run_dev_server()
        return

    try:
        from waitress import serve
    except ImportError:
        # Keep the service usable if the production dependency is missing,
        # but make the fallback obvious in the logs.
        print('waitress is not installed; falling back to the Flask development server')
        run_dev_server()
        return

    serve(app, host='127.0.0.1', port=5000)


if __name__ == '__main__':
    run_server()
