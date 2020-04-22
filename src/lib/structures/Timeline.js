const {Feed} = require("feed")
const constants = require("../constants")
const config = require("../../../config")
const TimelineEntry = require("./TimelineEntry")
const InstaCache = require("../cache")
const collectors = require("../collectors")
const {getFeedSetup} = require("../utils/feed")
require("../testimports")(constants, collectors, TimelineEntry, InstaCache)

/** @param {any[]} edges */
function transformEdges(edges) {
	return edges.map(e => {
		/** @type {import("../types").TimelineEntryAll} */
		const data = e.node
		const entry = collectors.getOrCreateShortcode(data.shortcode)
		entry.apply(data)
		return entry
	})
}

class Timeline {
	/**
	 * @param {import("./User")|import("./ReelUser")} user
	 */
	constructor(user) {
		this.user = user
		/** @type {import("./TimelineEntry")[][]} */
		this.pages = []
		if (this.user.data.edge_owner_to_timeline_media) {
			this.addPage(this.user.data.edge_owner_to_timeline_media)
		}
	}

	hasNextPage() {
		return this.page_info.has_next_page
	}

	fetchNextPage() {
		if (!this.hasNextPage()) return constants.symbols.NO_MORE_PAGES
		return collectors.fetchTimelinePage(this.user.data.id, this.page_info.end_cursor).then(page => {
			this.addPage(page)
			return this.pages.slice(-1)[0]
		})
	}

	async fetchUpToPage(index) {
		while (this.pages[index] === undefined && this.hasNextPage()) {
			await this.fetchNextPage()
		}
	}

	addPage(page) {
		this.pages.push(transformEdges(page.edges))
		this.page_info = page.page_info
		this.user.posts = page.count
	}

	async fetchFeed() {
		const setup = getFeedSetup(this.user.data.username, this.user.data.biography, constants.website_origin+this.user.proxyProfilePicture, new Date(this.user.cachedAt))
		const feed = new Feed(setup)
		const page = this.pages[0] // only get posts from first page
		await Promise.all(page.map(item =>
			item.fetchFeedData().then(feedData => feed.addItem(feedData))
		))
		return feed
	}
}

module.exports = Timeline
