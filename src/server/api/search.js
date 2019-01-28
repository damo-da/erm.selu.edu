import { Document, Name, DateModel } from 'server/database/models'
import { getMatchingSearches } from 'server/serverHelpers/search'
import _ from 'lodash'
import mongoose from 'mongoose'
import { parseDate } from 'server/serverHelpers/date-helper'
import { CustomError } from 'server/serverHelpers/error-handler'

const ObjectId = mongoose.Types.ObjectId

export default async function (ctx) {
  const searchParams = ctx.request.body
  // TODO validate search params

  let { searchText, beginAt, endAt, fullTextChecked, searchIn, type, subType } = searchParams
  let beginDate, endDate

  if (beginAt === undefined) beginAt = 0

  if (typeof beginAt !== 'number')
    throw new CustomError(`beginAt must be a number.`)

  const filter = new RegExp(searchText, 'i')

  let query, dates

  if (fullTextChecked) {
    query = Document.find({ fullText: filter })
  } else if (!type || type === 'all') {
    query = Document.find({ title: filter })
  } else if (type === 'date') {
    [ beginDate, endDate ] = parseDate(searchText, 'YYYYMMDD')

    dates = await DateModel.find({
      $and: [
        { notBefore: { $lte: beginDate.toISOString() } },
        { notAfter: { $gte: endDate.toISOString() } },
      ],
    })

    if (!dates.length) dates = [ ObjectId() ]

    const dateIds = dates.map(x => x._id.toString())

    query = Document.find({
      dates: {
        $in: dateIds,
      },
    })
  } else {
    let names

    if (subType && subType !== 'all') {
      names = await Name.find({ text: filter, type, subType })
    } else {
      names = await Name.find({ text: filter, type })
    }

    if (!names.length) names = [ ObjectId() ]

    const nameIds = names.map(x => x._id.toString())

    query = Document.find({
      names: {
        $in: nameIds,
      },
    })
  }

  if (searchIn !== 'all') {
    const [ type, subType ] = searchIn.split('.')
    if (subType) {
      query = query.find({ type, subType })
    } else {
      query = query.find({ type })
    }
  }

  const resultDocuments = await query
  const count = resultDocuments.length

  console.log('result count: ', count)

  let result = resultDocuments.map(doc => {
    let matches
    if (type === 'date') {
      const thisDates = dates.filter(x => doc.dates.indexOf(x._id) >= 0)
      matches = thisDates.map(x => ({
        showText: x.searchText,
      }))

    } else {
      matches = getMatchingSearches(doc.fullText, { searchText })
    }
    const ret = {
      fileId: doc.fileId,
      title: doc.title,
      type: doc.type,
      subType: doc.subType,
      id: doc._id,

      url: doc._url,

      weight: matches.length,
      matches: _.uniqBy(matches, 'showText'),
    }

    return ret
  })
  result = _.sortBy(result, x => -x.weight)

  ctx.response.body = {
    totalHits: _.sum(result.map(x => x.matches.length)), // total results
    totalDocumentHits: count, // total documents
    listItems: result,
  }
}