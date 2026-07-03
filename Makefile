# Makefile for claurdalie — web-based MSA editor (Vite + React + TypeScript)

# Use npm; override with `make NPM=pnpm ...` if desired.
NPM := npm

# Magenta ANSI color for the banner.
MAGENTA := \033[35m
RESET   := \033[0m

define BANNER

 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ██████╗  █████╗ ██╗     ██╗███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔══██╗██╔══██╗██║     ██║██╔════╝
██║     ██║     ███████║██║   ██║██████╔╝██║  ██║███████║██║     ██║█████╗
██║     ██║     ██╔══██║██║   ██║██╔══██╗██║  ██║██╔══██║██║     ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██║  ██║██████╔╝██║  ██║███████╗██║███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝╚══════╝

endef
export BANNER

.DEFAULT_GOAL := help

.PHONY: help install dev build preview run test test-watch typecheck check clean distclean

help: ## Show this help
	@printf '$(MAGENTA)%s$(RESET)\n' "$$BANNER"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies from package-lock.json
	$(NPM) ci

dev: node_modules ## Start the Vite dev server
	$(NPM) run dev

build: node_modules ## Type-check and build for production (outputs to dist/)
	$(NPM) run build

preview: node_modules ## Preview the production build locally
	$(NPM) run preview

run: build ## Build the latest and serve it locally
	$(NPM) run preview

test: node_modules ## Run the test suite once
	$(NPM) run test

test-watch: node_modules ## Run tests in watch mode
	$(NPM) run test:watch

typecheck: node_modules ## Type-check without emitting output
	$(NPM) run typecheck

check: typecheck test ## Run type-checking and tests

clean: ## Remove build artifacts and caches
	rm -rf dist dist-ssr coverage .vite *.tsbuildinfo

distclean: clean ## Also remove installed dependencies
	rm -rf node_modules

# Install deps automatically when node_modules is missing or stale.
node_modules: package.json package-lock.json
	$(NPM) install
	@touch node_modules
