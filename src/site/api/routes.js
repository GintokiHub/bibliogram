const constants = require("../../lib/constants")
const switcher = require("../../lib/utils/torswitcher")
const {fetchUser, getOrFetchShortcode, userRequestCache, history} = require("../../lib/collectors")
const {render, redirect} = require("pinski/plugins")
const {pugCache} = require("../passthrough")

/** @param {import("../../lib/structures/TimelineEntry")} post */
function getPageTitle(post) {
	return (post.getCaptionIntroduction() || `Post from @${post.getBasicOwner().username}`) + " | Bibliogram"
}

module.exports = [
	{
		route: "/", methods: ["GET"], code: async () => {
			return render(200, "pug/home.pug", {
				rssEnabled: constants.settings.rss_enabled,
				allUnblocked: history.testNoneBlocked(),
				torAvailable: switcher.canUseTor(),
				hasPrivacyPolicy: constants.has_privacy_policy
			})
		}
	},
	{
		route: "/privacy", methods: ["GET"], code: async () => {
			if (constants.has_privacy_policy && pugCache.has("pug/privacy.pug")) {
				return render(200, "pug/privacy.pug")
			} else {
				return render(404, "pug/friendlyerror.pug", {
					statusCode: 404,
					title: "No privacy policy",
					message: "No privacy policy",
					explanation:
						"The owner of this instance has not actually written a privacy policy."
						+"\nIf you own this instance, please read the file stored at /src/site/pug/privacy.pug.template."
				})
			}
		}
	},
	{
		route: `/u`, methods: ["GET"], code: async ({url}) => {
			if (url.searchParams.has("u")) {
				let username = url.searchParams.get("u")
				username = username.replace(/^(https?:\/\/)?([a-z]+\.)?instagram\.com\//, "")
				username = username.replace(/^\@+/, "")
				username = username.replace(/\/+$/, "")
				username = username.toLowerCase()
				return redirect(`/u/${username}`, 301)
			} else {
				return render(400, "pug/friendlyerror.pug", {
					statusCode: 400,
					title: "Bad request",
					message: "Expected a username",
					explanation: "Write /u/{username} or /u?u={username}.",
					withInstancesLink: false
				})
			}
		}
	},
	{
		route: `/u/(${constants.external.username_regex})`, methods: ["GET"], code: ({url, fill}) => {
			if (fill[0] !== fill[0].toLowerCase()) { // some capital letters
				return Promise.resolve(redirect(`/u/${fill[0].toLowerCase()}`, 301))
			}

			const params = url.searchParams
			return fetchUser(fill[0], false).then(async user => {
				const page = +params.get("page")
				if (typeof page === "number" && !isNaN(page) && page >= 1) {
					await user.timeline.fetchUpToPage(page - 1)
				}
				const {website_origin, settings: {display_feed_validation_buttons}} = constants
				return render(200, "pug/user.pug", {url, user, constants, website_origin, display_feed_validation_buttons})
			}).catch(error => {
				if (error === constants.symbols.NOT_FOUND || error === constants.symbols.ENDPOINT_OVERRIDDEN) {
					return render(404, "pug/friendlyerror.pug", {
						statusCode: 404,
						title: "Not found",
						message: "This user doesn't exist.",
						withInstancesLink: false
					})
				} else if (error === constants.symbols.INSTAGRAM_DEMANDS_LOGIN) {
					return {
						statusCode: 503,
						contentType: "text/html",
						headers: {
							"Retry-After": userRequestCache.getTtl("user/"+fill[0], 1000)
						},
						content: pugCache.get("pug/blocked.pug").web({
							expiresMinutes: userRequestCache.getTtl("user/"+fill[0], 1000*60)
						})
					}
				} else {
					throw error
				}
			})
		}
	},
	{
		route: `/fragment/user/(${constants.external.username_regex})/(\\d+)`, methods: ["GET"], code: async ({url, fill}) => {
			return fetchUser(fill[0], false).then(async user => {
				const pageNumber = +fill[1]
				const pageIndex = pageNumber - 1
				await user.timeline.fetchUpToPage(pageIndex)
				if (user.timeline.pages[pageIndex]) {
					return render(200, "pug/fragments/timeline_page.pug", {page: user.timeline.pages[pageIndex], pageIndex, user, url})
				} else {
					return {
						statusCode: 400,
						contentType: "text/html",
						content: "That page does not exist."
					}
				}
			}).catch(error => {
				if (error === constants.symbols.NOT_FOUND || error === constants.symbols.ENDPOINT_OVERRIDDEN) {
					return render(404, "pug/friendlyerror.pug", {
						statusCode: 404,
						title: "Not found",
						message: "This user doesn't exist.",
						withInstancesLink: false
					})
				} else {
					throw error
				}
			})
		}
	},
	{
		route: `/fragment/post/(${constants.external.shortcode_regex})`, methods: ["GET"], code: ({fill}) => {
			return getOrFetchShortcode(fill[0]).then(async post => {
				await post.fetchChildren()
				await post.fetchExtendedOwnerP() // serial await is okay since intermediate fetch result is cached
				if (post.isVideo()) await post.fetchVideoURL()
				return {
					statusCode: 200,
					contentType: "application/json",
					content: {
						title: getPageTitle(post),
						html: pugCache.get("pug/fragments/post.pug").web({post})
					}
				}
			}).catch(error => {
				if (error === constants.symbols.NOT_FOUND) {
					return render(404, "pug/friendlyerror.pug", {
						statusCode: 404,
						title: "Not found",
						message: "Somehow, you reached a post that doesn't exist.",
						withInstancesLink: false
					})
				} else {
					throw error
				}
			})
		}
	},
	{
		route: "/p", methods: ["GET"], code: async ({url}) => {
			if (url.searchParams.has("p")) {
				let post = url.searchParams.get("p")
				post = post.replace(/^(https?:\/\/)?([a-z]+\.)?instagram\.com\/p\//, "")
				return redirect(`/p/${post}`, 301)
			} else {
				return render(400, "pug/friendlyerror.pug", {
					statusCode: 400,
					title: "Bad request",
					message: "Expected a shortcode",
					explanation: "Write /p/{shortcode} or /p?p={shortcode}.",
					withInstancesLink: false
				})
			}
		}
	},
	{
		route: `/p/(${constants.external.shortcode_regex})`, methods: ["GET"], code: ({fill}) => {
			return getOrFetchShortcode(fill[0]).then(async post => {
				await post.fetchChildren()
				await post.fetchExtendedOwnerP() // serial await is okay since intermediate fetch result is cached
				if (post.isVideo()) await post.fetchVideoURL()
				return render(200, "pug/post.pug", {
					title: getPageTitle(post),
					post,
					website_origin: constants.website_origin
				})
			}).catch(error => {
				if (error === constants.symbols.NOT_FOUND) {
					return render(404, "pug/friendlyerror.pug", {
						statusCode: 404,
						title: "Not found",
						message: "Somehow, you reached a post that doesn't exist.",
						withInstancesLink: false
					})
				} else {
					throw error
				}
			})
		}
	}
]
