'use strict';

angular.module('ui.bootstrap.modal', ['ui.bootstrap.transition'])

	/**
	 * A helper, internal data structure that acts as a map but also allows getting / removing
	 * elements in the LIFO order
	 */
	.factory('$$stackedMap', [
		function stackedMapFactory() {
			return {
				createNew: function createNewStackedMap() {
					var stack = [];

					function removeFromStack(stackMap, modalInstanceWrapper) {
						if (stack.length) {
							for (var idx = (stack.length - 1); idx >= 0; idx--) {
								if (modalInstanceWrapper === stack[idx]) {
									if (modalInstanceWrapper.options.backdrop) {
										stackMap.backdropCount--;
									}
									return stack.splice(idx, 1);
								}
							}
						}
					}

					function Stack() {
						this.backdropCount = 0;
					}

					Stack.prototype = {
						add: function addModalInstance(modalInstanceWrapper) {
							if (modalInstanceWrapper.options.backdrop) {
								this.backdropCount++;
							}
							stack.push(modalInstanceWrapper);
						},
						get: function getModalInstance(modalInstanceWrapper) {
							if (stack.length) {
								for (var idx = 0; idx < stack.length; idx++) {
									if (modalInstanceWrapper === stack[idx]) {
										return stack[idx];
									}
								}
							}
						},
						top: function getTopModalInstance() {
							if (stack.length) {
								return stack[stack.length - 1];
							}
						},
						remove: function removeModalInstance(modalInstanceWrapper) {
							return removeFromStack(this, modalInstanceWrapper);
						},
						removeTop: function removeTopModalInstance() {
							return removeFromStack(this, this.getTopModalInstance());
						},
						length: function getModalInstanceLength() {
							return stack.length;
						}
					};

					return new Stack();
				}
			};
		}
	])

	/**
	 * A helper directive for the $modal service. It creates a backdrop element.
	 */
	.directive('modalBackdrop', [
		'$timeout',
		function modalBackdropDirective($timeout) {
			return {
				restrict: 'EA',
				replace: true,
				templateUrl: 'template/modal/backdrop.html',
				link: function postLink(scope) {
					scope.animate = true;
				}
			};
		}
	])

	.directive('modalWindow', [
		'$modalStack', '$timeout',
		function modalWindowDirective($modalStack, $timeout) {
			return {
				restrict: 'EA',
				scope: {
					index: '@',
					animate: '='
				},
				replace: true,
				transclude: true,
				templateUrl: function(tElement, tAttrs) {
					return tAttrs.templateUrl || 'template/modal/window.html';
				},
				link: function postLink(scope, element, attrs) {
					scope.windowClass = attrs.windowClass || '';

					$timeout(function () {
						// trigger CSS transitions
						scope.animate = true;

						/**
						 * Auto-focusing of a freshly-opened modal element causes any child elements
						 * with the autofocus attribute to loose focus. This is an issue on touch
						 * based devices which will show and then hide the onscreen keyboard.
						 * Attempts to refocus the autofocus element via JavaScript will not reopen
						 * the onscreen keyboard. Fixed by updated the focusing logic to only autofocus
						 * the modal element if the modal does not contain an autofocus element.
						 */
						if (!element[0].querySelectorAll('[autofocus]').length) {
							element[0].focus();
						}
					});

					scope.close = function (evt) {
						var modalInstanceWrapper = $modalStack.getTop();

						if (modalInstanceWrapper && modalInstanceWrapper.backdrop && modalInstanceWrapper.backdrop !== 'static' && (evt.target === evt.currentTarget)) {
							evt.preventDefault();
							evt.stopPropagation();
							$modalStack.dismiss(modalInstanceWrapper, 'backdrop click');
						}
					};
				}
			};
		}
	])

	.factory('$modalStack', [
		'$transition', '$timeout', '$document', '$compile', '$rootScope', '$$stackedMap',
		function modalStackFactory($transition, $timeout, $document, $compile, $rootScope, $$stackedMap) {
			var OPENED_MODAL_CLASS = 'modal-open',
				openedWindows = $$stackedMap.createNew(),
				$modalStack = {},
				backdropDomElm,
				backdropScope;

			function removeModalWindow(modalInstanceWrapper) {
				var body = $document.find('body').eq(0);

				// clean up the stack
				openedWindows.remove(modalInstanceWrapper);

				modalInstanceWrapper.elm.one($transition.transitionEndEventName, function onTransitionEnd(event) {
					modalInstanceWrapper.elm.remove();

					modalInstanceWrapper.scope.$apply();
					modalInstanceWrapper.scope.$destroy();

					body.toggleClass(OPENED_MODAL_CLASS, openedWindows.length() > 0);
					checkRemoveBackdrop();
				});

				// Closing animation
				$timeout(function() {
					modalInstanceWrapper.scope.animate = false;
				});
			}

			function checkRemoveBackdrop() {
				var backdropScopeRef;

				// remove backdrop if no longer needed
				if (backdropDomElm && openedWindows.backdropCount === 0) {

					backdropScope.animate = false;
					backdropScope.$apply();
					backdropScope.$destroy();

					backdropDomElm.remove();
					backdropDomElm = undefined;

					backdropScope = undefined;
				}
			}

			$rootScope.$watch(openedWindows.backdropCount, function watchModalBackdropIndex(newVal, oldVal){
				if (newVal !== oldVal && backdropScope) {
					backdropScope.index = (newVal - 1);
				}
			});

			$document.on('keydown', function onKeyDown(event) {
				var modalInstanceWrapper;

				if (event.which === 27) {
					modalInstanceWrapper = openedWindows.top();

					if (modalInstanceWrapper && modalInstanceWrapper.options.keyboard) {
						event.preventDefault();

						$rootScope.$apply(function () {
							$modalStack.dismiss(modalInstanceWrapper, 'escape key press');
						});
					}
				}
			});

			$modalStack.open = function modalStackOpen(modalInstanceWrapper) {
				var body = $document.find('body').eq(0),
					currBackdropIndex;

				modalInstanceWrapper.elm.attr('index', openedWindows.length() - 1);

				openedWindows.add(modalInstanceWrapper);

				currBackdropIndex = openedWindows.backdropCount - 1;

				if (currBackdropIndex >= 0 && !backdropDomElm) {
					backdropScope = $rootScope.$new(true);
					backdropScope.index = currBackdropIndex;

					backdropDomElm = $compile('<div data-modal-backdrop></div>')(backdropScope);
					body.append(backdropDomElm);
				}

				//openedWindows.top().elm = modalInstanceWrapper.elm;
				body.append(modalInstanceWrapper.elm);
				body.addClass(OPENED_MODAL_CLASS);
			};

			$modalStack.close = function modalStackClose(modalInstanceWrapper, result) {
				modalInstanceWrapper.resultDeferred.resolve(result);
				removeModalWindow(modalInstanceWrapper);
			};

			$modalStack.dismiss = function modalStackDismiss(modalInstanceWrapper, reason) {
				modalInstanceWrapper.resultDeferred.reject(reason);
				removeModalWindow(modalInstanceWrapper);
			};

			$modalStack.dismissAll = function modalStackDismissAll(reason) {
				var topModal = this.getTop();
				while (topModal) {
					this.dismiss(topModal, reason);
					topModal = this.getTop();
				}
			};

			$modalStack.getTop = function modalStackGetTop() {
				return openedWindows.top();
			};

			return $modalStack;
		}
	])

	.provider('$modal', [
		function modalProvider() {
			return {
				$get: [
					'$injector', '$rootScope', '$q', '$http', '$templateCache', '$compile', '$controller', '$modalStack', '$transition',
					function getModal($injector, $rootScope, $q, $http, $templateCache, $compile, $controller, $modalStack, $transition) {
						var defaultOptions = {
							backdrop: true, // can be also false or 'static'
							keyboard: true
						};


						function ModalInstance(wrapper) {
							this.result = wrapper.resultDeferred.promise;
							this.opened = wrapper.openedDeferred.promise;

							this.close = function close(result) {
								$modalStack.close(wrapper, result);
							};

							this.dismiss = function dismiss(reason) {
								$modalStack.dismiss(wrapper, reason);
							};
						}


						function ModalInstanceWrapper(options, elm) {
							var modalInstanceWrapper = this,
								templatePromise;

							// merge and clean up options
							options = angular.extend({
								resolve: {}
							}, defaultOptions, options);

							// verify options
							if (!options.template && !options.templateUrl) {
								throw new Error('One of template or templateUrl options is required.');
							}

							this.options = options;
							this.resultDeferred = $q.defer();
							this.openedDeferred = $q.defer();
							this.instance = new ModalInstance(this);

							templatePromise = (options.template)?
								$q.when(options.template) :
								$http.get(options.templateUrl, { cache: $templateCache })
									.then(function getModalTemplateSuccess(result) {
										return result.data;
									});

							$q.all([templatePromise])
								.then(function modalTemplatePromiseSuccess(template) {
									// Create an array of resolve promises
									var promises = [];

									// Add the resovle promises
									angular.forEach(options.resolve, function eachResolve(resolve) {
										if (angular.isFunction(resolve) || angular.isArray(resolve)) {
											promises.push($q.when($injector.invoke(resolve)));
										}
									});

									modalInstanceWrapper.template = template;

									$q.all(promises)
										.then(
											function modalResolveAllSuccess(vars) {
												var ctrlLocals = {},
													varsIdx = 0,
													ctrlInstance,
													modelWindowElm = angular.element('<div data-modal-window></div>')
														.attr({
															'template-url': options.windowTemplateUrl,
															'window-class': options.windowClass,
															'animate': 'animate'
														})
														.html(template);

												modalInstanceWrapper.controller = null;
												modalInstanceWrapper.scope = (options.scope || $rootScope).$new();
												modalInstanceWrapper.scope.$close = modalInstanceWrapper.instance.close;
												modalInstanceWrapper.scope.$dismiss = modalInstanceWrapper.instance.dismiss;

												// controllers
												if (options.controller) {
													ctrlLocals.$scope = modalInstanceWrapper.scope;
													ctrlLocals.$modalInstance = modalInstanceWrapper.instance;

													angular.forEach(options.resolve, function eachResolve(resolve, key) {
														ctrlLocals[key] = vars[varsIdx++];
													});

													modalInstanceWrapper.controller = $controller(options.controller, ctrlLocals);
												}

												// Compile the template
												modalInstanceWrapper.elm = $compile(modelWindowElm)(modalInstanceWrapper.scope);

												modalInstanceWrapper.elm.one($transition.transitionEndEventName, function onTransitionEnd(event) {
													modalInstanceWrapper.openedDeferred.resolve(true);
												});

												$modalStack.open(modalInstanceWrapper);

											},
											function modalResolveAllError(reason) {
												modalInstanceWrapper.resultDeferred.reject(reason);
												modalInstanceWrapper.openedDeferred.reject(false);
											}
										);
								});
						}

						// Return the public interface
						return {
							open: function openModal(options) {
								// prepare an instance of a modal to be injected into controllers and returned to a caller
								return new ModalInstanceWrapper(options).instance;
							}
						};
					}
				]
			};
		}
	]);

/* EOF */
